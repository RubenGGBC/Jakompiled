;; Fase 1: traducción a mano de bench.gc a wasm, tal como lo emitiría un
;; backend wasm de goalc *sin optimizar* (una instrucción IR -> unas pocas wasm).
;;
;; Modelo de ABI (el que propone docs/fase1-benchmark.md):
;;  - Memoria GOAL = memoria lineal. Puntero GOAL = dirección wasm.
;;  - Registros GPR de GOAL = locales i64. Al acceder a memoria: i32.wrap_i64.
;;  - Flotantes viajan en GPR (como en el x86 de goalc): bitcast f32 <-> i64.
;;  - Registros vf = locales v128 (SIMD128).
;;  - s7 (tabla de símbolos) = global. #f = s7, #t = s7 + TRUE_OFF.
;;  - Llamar a una función global: cargar el valor del símbolo (puntero GOAL al
;;    objeto function), cargar de ahí el índice en la Table y hacer call_indirect.
;;    Los offsets de símbolo son constantes que parchea el enlazador.
;;  - Firma uniforme por aridad: (i64 x n) -> i64.
;;  - Pila GOAL (new 'stack) = pila en memoria lineal con puntero global $sp.

(module
  (memory (export "mem") 16)
  (table (export "table") 8 funcref)

  (type $f1 (func (param i64) (result i64)))
  (type $f2 (func (param i64 i64) (result i64)))
  (type $f3 (func (param i64 i64 i64) (result i64)))

  ;; constantes de enlace (las fija el "linker" de JS, ver run.mjs)
  (global $s7 (export "s7") i64 (i64.const 0x10000))
  (global $sp (export "sp") (mut i32) (i32.const 0x80000))
  ;; offsets de símbolo respecto a s7
  ;;   TRUE      = 4
  ;;   bench-nop = 0x100, bench-matrix*! = 0x104, bench-sin = 0x108, bench-string= = 0x10c
  ;; cadenas estáticas: 0x30000 y 0x30100 (puntero al basic, datos en +4)

  (elem (i32.const 0) $bench-nop $bench-matrix*! $bench-sin $bench-string=)

  ;; ------------------------------------------------------------------ nop
  (func $bench-nop (type $f1) (param $a0 i64) (result i64)
    local.get $a0)

  ;; ------------------------------------------------------------------ matrix*!
  (func $bench-matrix*! (type $f3) (param $a0 i64) (param $a1 i64) (param $a2 i64) (result i64)
    (local $acc v128)
    (local $vf10 v128) (local $vf11 v128) (local $vf12 v128) (local $vf13 v128)
    (local $vf14 v128) (local $vf15 v128) (local $vf16 v128) (local $vf17 v128)
    (local $vf18 v128) (local $vf19 v128) (local $vf20 v128) (local $vf21 v128)
    ;; .lvf
    (local.set $vf10 (v128.load offset=0  (i32.wrap_i64 (local.get $a1))))
    (local.set $vf14 (v128.load offset=0  (i32.wrap_i64 (local.get $a2))))
    (local.set $vf15 (v128.load offset=16 (i32.wrap_i64 (local.get $a2))))
    (local.set $vf16 (v128.load offset=32 (i32.wrap_i64 (local.get $a2))))
    (local.set $vf17 (v128.load offset=48 (i32.wrap_i64 (local.get $a2))))
    (local.set $vf11 (v128.load offset=16 (i32.wrap_i64 (local.get $a1))))
    (local.set $vf12 (v128.load offset=32 (i32.wrap_i64 (local.get $a1))))
    (local.set $vf13 (v128.load offset=48 (i32.wrap_i64 (local.get $a1))))
    ;; fila 0. .mul.x.vf acc a b  =>  acc = a * splat(b.x)
    (local.set $acc (f32x4.mul (local.get $vf14)
      (i8x16.shuffle 0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3 (local.get $vf10) (local.get $vf10))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf15)
      (i8x16.shuffle 4 5 6 7 4 5 6 7 4 5 6 7 4 5 6 7 (local.get $vf10) (local.get $vf10)))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf16)
      (i8x16.shuffle 8 9 10 11 8 9 10 11 8 9 10 11 8 9 10 11 (local.get $vf10) (local.get $vf10)))))
    (local.set $vf18 (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf17)
      (i8x16.shuffle 12 13 14 15 12 13 14 15 12 13 14 15 12 13 14 15 (local.get $vf10) (local.get $vf10)))))
    ;; fila 1
    (local.set $acc (f32x4.mul (local.get $vf14)
      (i8x16.shuffle 0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3 (local.get $vf11) (local.get $vf11))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf15)
      (i8x16.shuffle 4 5 6 7 4 5 6 7 4 5 6 7 4 5 6 7 (local.get $vf11) (local.get $vf11)))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf16)
      (i8x16.shuffle 8 9 10 11 8 9 10 11 8 9 10 11 8 9 10 11 (local.get $vf11) (local.get $vf11)))))
    (local.set $vf19 (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf17)
      (i8x16.shuffle 12 13 14 15 12 13 14 15 12 13 14 15 12 13 14 15 (local.get $vf11) (local.get $vf11)))))
    ;; fila 2
    (local.set $acc (f32x4.mul (local.get $vf14)
      (i8x16.shuffle 0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3 (local.get $vf12) (local.get $vf12))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf15)
      (i8x16.shuffle 4 5 6 7 4 5 6 7 4 5 6 7 4 5 6 7 (local.get $vf12) (local.get $vf12)))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf16)
      (i8x16.shuffle 8 9 10 11 8 9 10 11 8 9 10 11 8 9 10 11 (local.get $vf12) (local.get $vf12)))))
    (local.set $vf20 (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf17)
      (i8x16.shuffle 12 13 14 15 12 13 14 15 12 13 14 15 12 13 14 15 (local.get $vf12) (local.get $vf12)))))
    ;; fila 3
    (local.set $acc (f32x4.mul (local.get $vf14)
      (i8x16.shuffle 0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3 (local.get $vf13) (local.get $vf13))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf15)
      (i8x16.shuffle 4 5 6 7 4 5 6 7 4 5 6 7 4 5 6 7 (local.get $vf13) (local.get $vf13)))))
    (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf16)
      (i8x16.shuffle 8 9 10 11 8 9 10 11 8 9 10 11 8 9 10 11 (local.get $vf13) (local.get $vf13)))))
    (local.set $vf21 (f32x4.add (local.get $acc) (f32x4.mul (local.get $vf17)
      (i8x16.shuffle 12 13 14 15 12 13 14 15 12 13 14 15 12 13 14 15 (local.get $vf13) (local.get $vf13)))))
    ;; .svf
    (v128.store offset=0  (i32.wrap_i64 (local.get $a0)) (local.get $vf18))
    (v128.store offset=16 (i32.wrap_i64 (local.get $a0)) (local.get $vf19))
    (v128.store offset=32 (i32.wrap_i64 (local.get $a0)) (local.get $vf20))
    (v128.store offset=48 (i32.wrap_i64 (local.get $a0)) (local.get $vf21))
    local.get $a0)

  ;; ------------------------------------------------------------------ sin
  (func $bench-sin (type $f1) (param $a0 i64) (result i64)
    (local $x f32) (local $t i64)
    (local $f2-0 f32) (local $f1-4 f32) (local $f0-3 f32) (local $f2-1 f32)
    (local $f1-5 f32) (local $f2-2 f32) (local $f1-6 f32) (local $f2-3 f32)
    (local $f1-7 f32) (local $f0-4 f32)
    ;; argumento flotante llega en GPR
    (local.set $x (f32.reinterpret_i32 (i32.wrap_i64 (local.get $a0))))
    ;; unwrap-angle: (the float (sar (shl (the int x) 48) 48))
    (local.set $t (i64.trunc_sat_f32_s (local.get $x)))
    (local.set $t (i64.shl (local.get $t) (i64.const 48)))
    (local.set $t (i64.shr_s (local.get $t) (i64.const 48)))
    (local.set $f2-0 (f32.mul (f32.const 0.000095873795) (f32.convert_i64_s (local.get $t))))
    (local.set $f1-4 (f32.mul (f32.const 0.999998) (local.get $f2-0)))
    (local.set $f0-3 (f32.mul (local.get $f2-0) (local.get $f2-0)))
    (local.set $f2-1 (f32.mul (local.get $f2-0) (local.get $f0-3)))
    (local.set $f1-5 (f32.add (local.get $f1-4) (f32.mul (f32.const -0.16666014) (local.get $f2-1))))
    (local.set $f2-2 (f32.mul (local.get $f2-1) (local.get $f0-3)))
    (local.set $f1-6 (f32.add (local.get $f1-5) (f32.mul (f32.const 0.008326521) (local.get $f2-2))))
    (local.set $f2-3 (f32.mul (local.get $f2-2) (local.get $f0-3)))
    (local.set $f1-7 (f32.add (local.get $f1-6) (f32.mul (f32.const -0.0001956241) (local.get $f2-3))))
    (local.set $f0-4 (f32.mul (local.get $f2-3) (local.get $f0-3)))
    ;; resultado flotante vuelve en GPR
    (i64.extend_i32_u (i32.reinterpret_f32
      (f32.add (local.get $f1-7) (f32.mul (f32.const 0.0000023042373) (local.get $f0-4))))))

  ;; ------------------------------------------------------------------ string=
  ;; Fiel al IR de goalc: cada (zero? x) / (nonzero? x) materializa un símbolo
  ;; #t/#f, y los if/while/and/or comparan ese símbolo con #f (s7).
  (func $bench-string= (type $f2) (param $a0 i64) (param $a1 i64) (result i64)
    (local $a2-0 i64) (local $v1-0 i64) (local $t i64) (local $u i64)
    (local.set $a2-0 (i64.add (i64.const 4) (local.get $a0)))
    (local.set $v1-0 (i64.add (i64.const 4) (local.get $a1)))
    ;; (or (zero? arg0) (zero? arg1))
    (local.set $t (select (i64.add (global.get $s7) (i64.const 4)) (global.get $s7)
                          (i64.eqz (local.get $a0))))
    (if (i64.eq (local.get $t) (global.get $s7))
      (then
        (local.set $t (select (i64.add (global.get $s7) (i64.const 4)) (global.get $s7)
                              (i64.eqz (local.get $a1))))))
    (if (i64.ne (local.get $t) (global.get $s7))
      (then (return (global.get $s7))))
    (block $done
      (loop $top
        ;; (and (nonzero? (-> a2-0 0)) (nonzero? (-> v1-0 0)))
        (local.set $u (i64.load8_u (i32.wrap_i64 (local.get $a2-0))))
        (local.set $t (select (global.get $s7) (i64.add (global.get $s7) (i64.const 4))
                              (i64.eqz (local.get $u))))
        (br_if $done (i64.eq (local.get $t) (global.get $s7)))
        (local.set $u (i64.load8_u (i32.wrap_i64 (local.get $v1-0))))
        (local.set $t (select (global.get $s7) (i64.add (global.get $s7) (i64.const 4))
                              (i64.eqz (local.get $u))))
        (br_if $done (i64.eq (local.get $t) (global.get $s7)))
        ;; (if (!= (-> a2-0 0) (-> v1-0 0)) (return #f)): sin CSE, vuelve a cargar
        (if (i64.ne (i64.load8_u (i32.wrap_i64 (local.get $a2-0)))
                    (i64.load8_u (i32.wrap_i64 (local.get $v1-0))))
          (then (return (global.get $s7))))
        (local.set $a2-0 (i64.add (i64.const 1) (local.get $a2-0)))
        (local.set $v1-0 (i64.add (i64.const 1) (local.get $v1-0)))
        (br $top)))
    ;; (and (zero? (-> a2-0 0)) (zero? (-> v1-0 0)))
    (local.set $t (select (i64.add (global.get $s7) (i64.const 4)) (global.get $s7)
                          (i64.eqz (i64.load8_u (i32.wrap_i64 (local.get $a2-0))))))
    (if (i64.eq (local.get $t) (global.get $s7))
      (then (return (local.get $t))))
    (select (i64.add (global.get $s7) (i64.const 4)) (global.get $s7)
            (i64.eqz (i64.load8_u (i32.wrap_i64 (local.get $v1-0))))))

  ;; ------------------------------------------------------------------ bucles
  ;; (dotimes (i n) ...) de goalc: comprobación al final del bucle.

  (func (export "bench-nop-loop") (param $n i64) (result i64)
    (local $acc i64) (local $i i64) (local $f i32)
    (block $exit
      (br_if $exit (i64.ge_s (local.get $i) (local.get $n)))
      (loop $top
        ;; valor del símbolo -> objeto function -> índice de tabla
        (local.set $f (i32.load offset=0x100 (i32.wrap_i64 (global.get $s7))))
        (local.set $acc (i64.add (local.get $acc)
          (call_indirect (type $f1) (local.get $i) (i32.load (local.get $f)))))
        (local.set $i (i64.add (local.get $i) (i64.const 1)))
        (br_if $top (i64.lt_s (local.get $i) (local.get $n)))))
    local.get $acc)

  (func (export "bench-matrix-loop") (param $n i64) (result i64)
    (local $a i64) (local $b i64) (local $c i64) (local $i i64) (local $f i32)
    (local $old-sp i32) (local $r f32)
    ;; (new 'stack-no-clear 'bmatrix) x3, alineado a 16
    (local.set $old-sp (global.get $sp))
    (global.set $sp (i32.sub (global.get $sp) (i32.const 192)))
    (local.set $a (i64.extend_i32_u (global.get $sp)))
    (local.set $b (i64.add (local.get $a) (i64.const 64)))
    (local.set $c (i64.add (local.get $a) (i64.const 128)))
    (local.set $i (i64.const 0))
    (loop $init
      (f32.store
        (i32.wrap_i64 (i64.add (local.get $a) (i64.shl (local.get $i) (i64.const 2))))
        (if (result f32) (i64.eqz (i64.rem_s (local.get $i) (i64.const 5)))
          (then (f32.const 1.0)) (else (f32.const 0.0))))
      (f32.store
        (i32.wrap_i64 (i64.add (local.get $b) (i64.shl (local.get $i) (i64.const 2))))
        (f32.mul (f32.const 0.25) (f32.convert_i64_s (i64.add (local.get $i) (i64.const 1)))))
      (local.set $i (i64.add (local.get $i) (i64.const 1)))
      (br_if $init (i64.lt_s (local.get $i) (i64.const 16))))
    (local.set $i (i64.const 0))
    (block $exit
      (br_if $exit (i64.ge_s (local.get $i) (local.get $n)))
      (loop $top
        (local.set $f (i32.load offset=0x104 (i32.wrap_i64 (global.get $s7))))
        (drop (call_indirect (type $f3) (local.get $c) (local.get $a) (local.get $b)
          (i32.load (local.get $f))))
        (local.set $i (i64.add (local.get $i) (i64.const 1)))
        (br_if $top (i64.lt_s (local.get $i) (local.get $n)))))
    (local.set $r (f32.mul (f32.const 1000.0)
      (f32.add (f32.load offset=0 (i32.wrap_i64 (local.get $c)))
               (f32.load offset=60 (i32.wrap_i64 (local.get $c))))))
    (global.set $sp (local.get $old-sp))
    (i64.trunc_sat_f32_s (local.get $r)))

  (func (export "bench-sin-loop") (param $n i64) (result i64)
    (local $acc f32) (local $i i64) (local $f i32)
    (block $exit
      (br_if $exit (i64.ge_s (local.get $i) (local.get $n)))
      (loop $top
        (local.set $f (i32.load offset=0x108 (i32.wrap_i64 (global.get $s7))))
        (local.set $acc (f32.add (local.get $acc)
          (f32.reinterpret_i32 (i32.wrap_i64
            (call_indirect (type $f1)
              (i64.extend_i32_u (i32.reinterpret_f32 (f32.convert_i64_s (local.get $i))))
              (i32.load (local.get $f)))))))
        (local.set $i (i64.add (local.get $i) (i64.const 1)))
        (br_if $top (i64.lt_s (local.get $i) (local.get $n)))))
    (i64.trunc_sat_f32_s (local.get $acc)))

  (func (export "bench-string-loop") (param $n i64) (result i64)
    (local $cnt i64) (local $i i64) (local $f i32)
    (block $exit
      (br_if $exit (i64.ge_s (local.get $i) (local.get $n)))
      (loop $top
        (local.set $f (i32.load offset=0x10c (i32.wrap_i64 (global.get $s7))))
        ;; (if x ...) en GOAL: x != #f
        (if (i64.ne (global.get $s7)
              (call_indirect (type $f2) (i64.const 0x30000) (i64.const 0x30100)
                (i32.load (local.get $f))))
          (then (local.set $cnt (i64.add (local.get $cnt) (i64.const 1)))))
        (local.set $i (i64.add (local.get $i) (i64.const 1)))
        (br_if $top (i64.lt_s (local.get $i) (local.get $n)))))
    local.get $cnt)
)
