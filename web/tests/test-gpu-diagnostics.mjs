import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../gpu-diagnostics.js', import.meta.url), 'utf8');
function setup(mode, worker = false) {
  const calls = [], workers = [], imports = [];
  class GL {
    constructor() {
      Object.assign(this, {TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, TRIANGLES: 4,
        UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125,
        ELEMENT_ARRAY_BUFFER: 34963, ELEMENT_ARRAY_BUFFER_BINDING: 34965,
        ARRAY_BUFFER: 34962, ARRAY_BUFFER_BINDING: 34964, BUFFER_SIZE: 34660,
        COPY_READ_BUFFER: 36662, COPY_READ_BUFFER_BINDING: 36662,
        COPY_WRITE_BUFFER: 36663, COPY_WRITE_BUFFER_BINDING: 36663});
      this.buffer = {};
      this.reads = 0;
      this.uploads = 0;
      this.deleted = [];
      this.drawn = [];
    }
    get bytes() { return this.buffer.bytes; }
    set bytes(value) { this.buffer.bytes = value; }
    createBuffer() { return {}; }
    bindBuffer(target, buffer) { this.buffer = buffer; }
    deleteBuffer(buffer) { this.deleted.push(buffer); }
    getParameter() { return this.buffer; }
    getBufferParameter() { return this.bytes.length; }
    getBufferSubData(target, offset, dst) { this.reads++; dst.set(this.bytes); }
    bufferData(target, data, usage, sourceOffset = 0, length = 0) {
      this.uploads++;
      if (typeof data === 'number') { this.bytes = new Uint8Array(data); return; }
      const unit = data.BYTES_PER_ELEMENT || 1;
      const start = data.byteOffset + sourceOffset * unit;
      this.bytes = new Uint8Array(data.buffer.slice(start, start + (length ? length * unit : data.byteLength - sourceOffset * unit)));
    }
    bufferSubData(target, offset, data, sourceOffset = 0, length = 0) {
      const unit = data.BYTES_PER_ELEMENT || 1;
      this.bytes.set(new Uint8Array(data.buffer, data.byteOffset + sourceOffset * unit,
        length ? length * unit : data.byteLength - sourceOffset * unit), offset);
    }
    copyBufferSubData() {}
    drawElements(...args) { calls.push(args); this.drawn.push([...new Uint32Array(this.bytes.buffer)]); }
    drawElementsInstanced(...args) { calls.push(args); }
    shaderSource(shader, text) { calls.push(text); }
  }
  const original = GL.prototype.drawElements;
  const context = {location: new URL(`http://localhost:8080/${worker ? 'gpu-diagnostics.js' : ''}?gpu-test=${mode}`),
    URL, URLSearchParams, console: {info() {}}, Uint8Array, Uint16Array, Uint32Array,
    WebGL2RenderingContext: GL, Worker: class {constructor(...args) {workers.push(args);}},
    importScripts: url => imports.push(url), ...(worker ? {} : {document: {}})};
  runInNewContext(source, context);
  return {gl: new GL(), calls, original, context, workers, imports};
}

test('sin diagnóstico no cambia WebGL ni redirige workers', () => {
  const {gl, original, context, workers} = setup('');
  assert.equal(gl.drawElements, original);
  new context.Worker('gk.js', {name: 'em-pthread-1'});
  assert.equal(workers[0][0], 'gk.js');
});

test('el worker conserva nombre, modo, origen y carga el runtime original', () => {
  const {context, workers} = setup('split-strips');
  new context.Worker('gk.js', {name: 'em-pthread-2'});
  assert.equal(workers[0][0], 'http://localhost:8080/gpu-diagnostics.js?gpu-test=split-strips');
  assert.equal(workers[0][1].name, 'em-pthread-2');
  new context.Worker('extract-worker.js');
  assert.equal(workers[1][0], 'extract-worker.js');
  const {imports} = setup('split-strips', true);
  assert.deepEqual(imports, ['http://localhost:8080/gk.js']);
});

for (const Index of [Uint8Array, Uint16Array, Uint32Array]) {
  test(`divide reinicios de ${Index.name}, respeta offset e instancias`, () => {
    const {gl, calls} = setup('split-strips');
    const max = Index === Uint32Array ? 0xffffffff : Index === Uint16Array ? 0xffff : 0xff;
    const type = Index === Uint32Array ? gl.UNSIGNED_INT : Index === Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Index([99, 0, 1, 2, max, max, 3, 4, 5, 6, max, 7]));
    gl.drawElementsInstanced(gl.TRIANGLE_STRIP, 11, type, Index.BYTES_PER_ELEMENT, 2);
    assert.deepEqual(calls, [[5, 3, type, Index.BYTES_PER_ELEMENT, 2],
      [5, 4, type, 6 * Index.BYTES_PER_ELEMENT, 2]]);
  });
}

test('reutiliza lecturas y vuelve a leer al actualizar por otro target', () => {
  const {gl, calls} = setup('split-strips');
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 0xffffffff, 3, 4, 5]));
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  assert.equal(gl.reads, 1);
  gl.bufferSubData(gl.COPY_WRITE_BUFFER, 12, new Uint32Array([6]));
  calls.length = 0;
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  assert.equal(gl.reads, 2);
  assert.deepEqual(calls, [[5, 7, gl.UNSIGNED_INT, 0]]);
});

test('triángulos, offsets inválidos y draws fuera del buffer pasan al original', () => {
  const {gl, calls} = setup('split-strips');
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2]));
  gl.drawElements(4, 3, gl.UNSIGNED_INT, 0);
  gl.drawElements(5, 3, gl.UNSIGNED_INT, 1);
  gl.drawElements(5, 10, gl.UNSIGNED_INT, 0);
  assert.deepEqual(calls, [[4, 3, 5125, 0], [5, 3, 5125, 1], [5, 10, 5125, 0]]);
  assert.equal(gl.reads, 0);
});

test('oculta solo sprites de modo 3 y conserva los demás shaders', () => {
  const {gl, calls} = setup('no-sprites3d');
  gl.shaderSource({}, 'vec4 sprite_transform2() {}\nvoid main() { gl_Position = tex_info_in; }');
  assert.match(calls[0], /void gpu_test_original_main\(\)/);
  assert.match(calls[0], /if \(tex_info_in.w == 3u\)/);
  gl.shaderSource({}, 'void main() {}');
  assert.equal(calls[1], 'void main() {}');
});

test('convierte tiras con winding alterno y restablece la paridad tras cada reinicio', () => {
  const {gl, calls} = setup('triangles');
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 3, 0xffffffff, 4, 5, 6, 7]));
  const original = gl.buffer;
  gl.drawElements(5, 9, gl.UNSIGNED_INT, 0);
  assert.deepEqual(calls, [[4, 12, gl.UNSIGNED_INT, 0]]);
  assert.deepEqual(gl.drawn[0], [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
  assert.equal(gl.buffer, original);
  gl.drawElementsInstanced(5, 9, gl.UNSIGNED_INT, 0, 3);
  assert.deepEqual(calls[1], [4, 12, gl.UNSIGNED_INT, 0, 3]);
  assert.equal(gl.reads, 0);
  assert.equal(gl.uploads, 2);
  assert.equal(gl.buffer, original);
});

test('convierte abanicos de 16 bits respetando offset, degenerados y reinicios', () => {
  const {gl} = setup('triangles');
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([99, 0, 1, 1, 2, 0xffff, 3, 4, 5]));
  gl.drawElements(6, 8, gl.UNSIGNED_SHORT, 2);
  assert.deepEqual(gl.drawn[0], [0, 1, 1, 0, 1, 2, 3, 4, 5]);
});

test('libera conversiones al actualizar y eliminar el buffer de origen', () => {
  const {gl} = setup('triangles');
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 0xffffffff, 3, 4, 5]));
  const original = gl.buffer;
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  gl.bufferSubData(gl.COPY_WRITE_BUFFER, 0, new Uint32Array([9]));
  assert.equal(gl.deleted.length, 1);
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  assert.deepEqual(gl.drawn[1], [9, 1, 2, 3, 4, 5]);
  assert.equal(gl.reads, 0);
  gl.deleteBuffer(original);
  assert.equal(gl.deleted.length, 3);
});

test('mil tiras se dibujan en una llamada y reutilizan la conversión', () => {
  const {gl, calls} = setup('triangles');
  const data = new Uint32Array(4000);
  for (let i = 0; i < 1000; i++) data.set([0, 1, 2, 0xffffffff], i * 4);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data);
  for (let frame = 0; frame < 5; frame++) gl.drawElements(5, data.length, gl.UNSIGNED_INT, 0);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call[0] === 4 && call[1] === 3000));
  assert.equal(gl.reads, 0);
  assert.equal(gl.uploads, 2);
});

test('partículas: subir índices iguales cada frame conserva la conversión sin leer la GPU', () => {
  const {gl, calls} = setup('triangles');
  gl.getBufferSubData = () => { throw new Error('lectura GPU inesperada'); };
  const heap = new Uint8Array(64);
  const data = new Uint32Array([0, 1, 2, 0xffffffff, 3, 4, 5]);
  heap.set(new Uint8Array(data.buffer), 8);
  for (let frame = 0; frame < 10; frame++) {
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, heap, 35040, 8, data.byteLength);
    gl.drawElements(5, data.length, gl.UNSIGNED_INT, 0);
  }
  assert.equal(calls.length, 10);
  assert.equal(gl.uploads, 11); // diez subidas originales y una conversión
  assert.equal(gl.deleted.length, 0);
  assert.deepEqual(gl.drawn[9], [0, 1, 2, 3, 4, 5]);
});

test('partículas: los índices cambiantes actualizan la copia CPU con rangos de Emscripten', () => {
  const {gl} = setup('triangles');
  gl.getBufferSubData = () => { throw new Error('lectura GPU inesperada'); };
  const heap = new Uint32Array([99, 0, 1, 2, 0xffffffff, 3, 4, 5, 99]);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, heap, 35040, 1, 7);
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  heap[1] = 9;
  gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, heap, 1, 1);
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  assert.deepEqual(gl.drawn[1], [9, 1, 2, 3, 4, 5]);
  assert.equal(gl.deleted.length, 1);
  heap[1] = 10;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, heap, 35040, 1, 7);
  gl.drawElements(5, 7, gl.UNSIGNED_INT, 0);
  assert.deepEqual(gl.drawn[2], [10, 1, 2, 3, 4, 5]);
});
