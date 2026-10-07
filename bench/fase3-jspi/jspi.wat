;; Fase 3: coste de suspender/reanudar procesos GOAL con JSPI.
;;
;; Modelo: un kernel recorre P procesos por frame. Cada proceso ejecuta un poco de
;; trabajo y llama a (suspend), igual que el bucle típico de un proceso GOAL:
;;   (loop (do-work) (suspend))
;;
;; Variante JSPI: cada proceso vive en su propia pila (una llamada "promising" que
;; nunca termina). $resume y $suspend son imports "Suspending": cada cambio de
;; proceso pasa por una promesa de JS.
;; Variante base: el proceso es una función normal que hace una iteración y vuelve
;; (lo que daría compilar los procesos como máquinas de estado, sin pilas).

(module
  (import "env" "resume" (func $resume (param i32)))   ;; kernel -> proceso (Suspending)
  (import "env" "suspend" (func $suspend))             ;; proceso -> kernel (Suspending)
  (memory (export "mem") 1)
  (table 1 funcref)
  (elem (i32.const 0) $proc-step)
  (type $step (func (param i32)))

  ;; trabajo del proceso: incrementar su contador (en memoria, como un campo del proceso)
  (func $work (param $pid i32)
    (i32.store (i32.shl (local.get $pid) (i32.const 2))
      (i32.add (i32.load (i32.shl (local.get $pid) (i32.const 2))) (i32.const 1))))

  ;; ---- variante JSPI
  (func (export "proc") (param $pid i32)
    (loop $forever
      (call $work (local.get $pid))
      (call $suspend)
      (br $forever)))

  (func (export "kernel_jspi") (param $frames i32) (param $procs i32)
    (local $f i32) (local $p i32)
    (loop $frame
      (local.set $p (i32.const 0))
      (loop $each
        (call $resume (local.get $p))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $each (i32.lt_u (local.get $p) (local.get $procs))))
      (local.set $f (i32.add (local.get $f) (i32.const 1)))
      (br_if $frame (i32.lt_u (local.get $f) (local.get $frames)))))

  ;; ---- variante base: una iteración del proceso por llamada indirecta
  (func $proc-step (param $pid i32)
    (call $work (local.get $pid)))

  (func (export "kernel_plain") (param $frames i32) (param $procs i32)
    (local $f i32) (local $p i32)
    (loop $frame
      (local.set $p (i32.const 0))
      (loop $each
        (call_indirect (type $step) (local.get $p) (i32.const 0))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $each (i32.lt_u (local.get $p) (local.get $procs))))
      (local.set $f (i32.add (local.get $f) (i32.const 1)))
      (br_if $frame (i32.lt_u (local.get $f) (local.get $frames)))))
)
