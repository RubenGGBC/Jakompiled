// Diagnóstico optativo de Metal. También sirve de entrada a los workers de Emscripten.
// Sin ?gpu-test=... no modifica WebGL ni la creación de workers.
(() => {
  const worker = typeof document === 'undefined';
  const mode = new URLSearchParams(location.search).get('gpu-test');
  const enabled = ['split-strips', 'no-sprites3d', 'triangles'].includes(mode);
  if (enabled) {
    console.info(`[gpu-test] ${mode}`);
    // El renderer vive en un pthread: instalar los hooks únicamente en la página no basta.
    if (typeof Worker !== 'undefined') {
      const NativeWorker = Worker;
      globalThis.Worker = class extends NativeWorker {
        constructor(url, options) {
          const target = new URL(url, location.href);
          if (target.origin === location.origin && target.pathname.endsWith('/gk.js')) {
            const entry = new URL('gpu-diagnostics.js', target);
            entry.searchParams.set('gpu-test', mode);
            url = entry.href;
          }
          super(url, options);
        }
      };
    }
    const proto = globalThis.WebGL2RenderingContext?.prototype;
    if (proto && mode === 'no-sprites3d') {
      const shaderSource = proto.shaderSource;
      proto.shaderSource = function(shader, source) {
        if (source.includes('sprite_transform2(') && source.includes('tex_info_in')) {
          source = source.replace(/void\s+main\s*\(\s*\)/, 'void gpu_test_original_main()');
          source += '\nvoid main() { gpu_test_original_main(); if (tex_info_in.w == 3u) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }\n';
          console.info('[gpu-test] partículas 3D ocultas');
        }
        return shaderSource.call(this, shader, source);
      };
    }
    if (proto && (mode === 'split-strips' || mode === 'triangles')) {
      // Lectura síncrona solo al cambiar el buffer: es un diagnóstico, puede ser más lento.
      const contexts = new WeakMap();
      const cacheFor = gl => {
        if (!contexts.has(gl)) contexts.set(gl, new WeakMap());
        return contexts.get(gl);
      };
      const bindingFor = (gl, target) => ({
        [gl.ARRAY_BUFFER]: gl.ARRAY_BUFFER_BINDING,
        [gl.ELEMENT_ARRAY_BUFFER]: gl.ELEMENT_ARRAY_BUFFER_BINDING,
        [gl.COPY_READ_BUFFER]: gl.COPY_READ_BUFFER_BINDING,
        [gl.COPY_WRITE_BUFFER]: gl.COPY_WRITE_BUFFER_BINDING,
        [gl.PIXEL_PACK_BUFFER]: gl.PIXEL_PACK_BUFFER_BINDING,
        [gl.PIXEL_UNPACK_BUFFER]: gl.PIXEL_UNPACK_BUFFER_BINDING,
        [gl.TRANSFORM_FEEDBACK_BUFFER]: gl.TRANSFORM_FEEDBACK_BUFFER_BINDING,
        [gl.UNIFORM_BUFFER]: gl.UNIFORM_BUFFER_BINDING,
      })[target];
      const nativeDelete = proto.deleteBuffer;
      const release = (gl, record) => {
        if (!record) return;
        for (const draw of record.draws.values()) {
          if (draw.buffer) nativeDelete.call(gl, draw.buffer);
        }
        record.draws.clear();
      };
      const invalidate = (gl, target) => {
        const binding = bindingFor(gl, target);
        if (binding === undefined) return;
        const buffer = gl.getParameter(binding);
        if (buffer) {
          release(gl, cacheFor(gl).get(buffer));
          cacheFor(gl).delete(buffer);
        }
      };
      const sourceBytes = (data, offset = 0, length = 0) => {
        if (!ArrayBuffer.isView(data)) return null;
        const unit = data.BYTES_PER_ELEMENT || 1;
        const available = data.byteLength / unit;
        if (!Number.isInteger(offset) || offset < 0 || offset > available
            || !Number.isInteger(length) || length < 0 || (length && offset + length > available)) return null;
        return new Uint8Array(data.buffer, data.byteOffset + offset * unit,
          (length || available - offset) * unit);
      };
      const sameBytes = (a, b, offset = 0) => {
        if (!a || offset + b.length > a.length) return false;
        for (let i = 0; i < b.length; i++) if (a[offset + i] !== b[i]) return false;
        return true;
      };
      const nativeData = proto.bufferData;
      proto.bufferData = function(target, data, usage, ...range) {
        const binding = bindingFor(this, target);
        const buffer = binding === undefined ? null : this.getParameter(binding);
        const old = buffer && cacheFor(this).get(buffer);
        const bytes = mode === 'triangles' && buffer
          && (target === this.ELEMENT_ARRAY_BUFFER || old) ? sourceBytes(data, ...range) : null;
        const result = nativeData.call(this, target, data, usage, ...range);
        // Sprite3 vuelve a subir sus índices cada fotograma. Conservar la copia CPU
        // evita getBufferSubData (sincronización GPU→CPU); si son iguales, conservar
        // también las listas de triángulos ya subidas.
        if (bytes && old?.bytes.length === bytes.length && sameBytes(old.bytes, bytes)) return result;
        invalidate(this, target);
        if (bytes) cacheFor(this).set(buffer, {bytes: bytes.slice(), draws: new Map()});
        return result;
      };
      const nativeSubData = proto.bufferSubData;
      proto.bufferSubData = function(target, offset, data, ...range) {
        const binding = bindingFor(this, target);
        const buffer = binding === undefined ? null : this.getParameter(binding);
        const record = buffer && cacheFor(this).get(buffer);
        const bytes = mode === 'triangles' && record ? sourceBytes(data, ...range) : null;
        const result = nativeSubData.call(this, target, offset, data, ...range);
        if (bytes && Number.isInteger(offset) && offset >= 0 && offset + bytes.length <= record.bytes.length) {
          if (!sameBytes(record.bytes, bytes, offset)) {
            release(this, record);
            record.bytes.set(bytes, offset);
          }
        } else invalidate(this, target);
        return result;
      };
      const copy = proto.copyBufferSubData;
      proto.copyBufferSubData = function(read, write, ...args) {
        invalidate(this, write);
        return copy.call(this, read, write, ...args);
      };
      const makeDraw = original => function(primitive, count, type, offset, ...rest) {
        const fallback = () => original.call(this, primitive, count, type, offset, ...rest);
        if (primitive !== this.TRIANGLE_STRIP && primitive !== this.TRIANGLE_FAN) return fallback();
        const Index = type === this.UNSIGNED_INT ? Uint32Array
          : type === this.UNSIGNED_SHORT ? Uint16Array : type === this.UNSIGNED_BYTE ? Uint8Array : null;
        if (!Index || !Number.isInteger(count) || count < 0 || !Number.isInteger(offset)
            || offset < 0 || offset % Index.BYTES_PER_ELEMENT) return fallback();
        const buffer = this.getParameter(this.ELEMENT_ARRAY_BUFFER_BINDING);
        if (!buffer) return fallback();
        const cache = cacheFor(this);
        let record = cache.get(buffer);
        if (!record) {
          const size = this.getBufferParameter(this.ELEMENT_ARRAY_BUFFER, this.BUFFER_SIZE);
          if (offset + count * Index.BYTES_PER_ELEMENT > size) return fallback();
          const bytes = new Uint8Array(size);
          this.getBufferSubData(this.ELEMENT_ARRAY_BUFFER, 0, bytes);
          record = {bytes, draws: new Map()};
          cache.set(buffer, record);
        }
        const {bytes} = record;
        if (offset + count * Index.BYTES_PER_ELEMENT > bytes.length) return fallback();
        const key = `${primitive}:${type}:${offset}:${count}`;
        if (mode === 'triangles' && record.draws.has(key)) {
          const draw = record.draws.get(key);
          if (!draw.buffer) return fallback();
          this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, draw.buffer);
          try { return original.call(this, this.TRIANGLES, draw.count, this.UNSIGNED_INT, 0, ...rest); }
          finally { this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, buffer); }
        }
        const indices = new Index(bytes.buffer, offset, count);
        const restart = type === this.UNSIGNED_INT ? 0xffffffff
          : type === this.UNSIGNED_SHORT ? 0xffff : 0xff;
        if (!indices.includes(restart)) {
          if (mode === 'triangles') record.draws.set(key, {buffer: null});
          return fallback();
        }
        if (mode === 'triangles') {
          // El tercer índice sigue siendo el provoking vertex; alternar los dos primeros
          // mantiene el winding de las tiras, incluyendo triángulos degenerados.
          const triangles = new Uint32Array(Math.max(0, count - 2) * 3);
          let used = 0, start = 0;
          for (let i = 0; i < count; i++) {
            if (indices[i] === restart) { start = i + 1; continue; }
            if (i - start < 2) continue;
            const odd = primitive === this.TRIANGLE_STRIP && (i - start) % 2 === 1;
            triangles[used++] = primitive === this.TRIANGLE_FAN ? indices[start] : indices[i - (odd ? 1 : 2)];
            triangles[used++] = indices[i - (odd ? 2 : 1)];
            triangles[used++] = indices[i];
          }
          const converted = this.createBuffer();
          if (!converted) return fallback();
          this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, converted);
          try {
            nativeData.call(this, this.ELEMENT_ARRAY_BUFFER, triangles.subarray(0, used), this.STATIC_DRAW);
            record.draws.set(key, {buffer: converted, count: used});
            return original.call(this, this.TRIANGLES, used, this.UNSIGNED_INT, 0, ...rest);
          } finally { this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, buffer); }
        }
        let start = 0;
        for (let i = 0; i <= count; i++) {
          if (i === count || indices[i] === restart) {
            // Cada reinicio restablece también el winding de la tira.
            if (i - start >= 3) original.call(this, primitive, i - start, type,
              offset + start * Index.BYTES_PER_ELEMENT, ...rest);
            start = i + 1;
          }
        }
      };
      proto.drawElements = makeDraw(proto.drawElements);
      proto.drawElementsInstanced = makeDraw(proto.drawElementsInstanced);
      proto.deleteBuffer = function(buffer) {
        release(this, cacheFor(this).get(buffer));
        cacheFor(this).delete(buffer);
        return nativeDelete.call(this, buffer);
      };
    }
  }
  if (worker) importScripts(new URL('gk.js', location.href).href);
})();
