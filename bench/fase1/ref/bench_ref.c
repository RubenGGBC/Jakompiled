// Fase 1: las mismas funciones en C, compiladas con clang -O2 a nativo y a wasm32.
// Es el "techo": lo que da un compilador maduro (LLVM) en cada plataforma.
// Las llamadas pasan por un puntero a función en memoria, como las de GOAL.
//
//   nativo: clang -O2 -o bench_ref bench_ref.c
//   wasm:   clang --target=wasm32 -O2 -msimd128 -nostdlib -Wl,--no-entry \
//             -Wl,--export-dynamic -o bench_ref.wasm bench_ref.c

#include <stdint.h>

#define EXPORT __attribute__((visibility("default")))
#define NOINLINE __attribute__((noinline))

typedef float v4 __attribute__((vector_size(16), aligned(16)));
typedef struct {
  v4 quad[4];
} bmatrix;

static inline v4 splat(v4 v, int i) {
  return (v4){v[i], v[i], v[i], v[i]};
}

NOINLINE static int64_t ref_nop(int64_t a) {
  return a;
}

NOINLINE static bmatrix* ref_matrix_mul(bmatrix* d, const bmatrix* a, const bmatrix* b) {
  v4 b0 = b->quad[0], b1 = b->quad[1], b2 = b->quad[2], b3 = b->quad[3];
  for (int r = 0; r < 4; r++) {
    v4 x = a->quad[r];
    d->quad[r] = b0 * splat(x, 0) + b1 * splat(x, 1) + b2 * splat(x, 2) + b3 * splat(x, 3);
  }
  return d;
}

NOINLINE static float ref_sin(float x) {
  // unwrap-angle: (sar (shl (the int x) 48) 48) = extender el signo de los 16 bits bajos
  float f2_0 = 0.000095873795f * (float)(int16_t)(int64_t)x;
  float f1_4 = 0.999998f * f2_0;
  float f0_3 = f2_0 * f2_0;
  float f2_1 = f2_0 * f0_3;
  float f1_5 = f1_4 + -0.16666014f * f2_1;
  float f2_2 = f2_1 * f0_3;
  float f1_6 = f1_5 + 0.008326521f * f2_2;
  float f2_3 = f2_2 * f0_3;
  float f1_7 = f1_6 + -0.0001956241f * f2_3;
  float f0_4 = f2_3 * f0_3;
  return f1_7 + 0.0000023042373f * f0_4;
}

NOINLINE static int ref_string_eq(const char* a, const char* b) {
  if (!a || !b) {
    return 0;
  }
  while (*a && *b) {
    if (*a != *b) {
      return 0;
    }
    a++;
    b++;
  }
  return *a == 0 && *b == 0;
}

// punteros en memoria global: el compilador no puede ver a quién se llama
int64_t (*volatile p_nop)(int64_t) = ref_nop;
bmatrix* (*volatile p_matrix)(bmatrix*, const bmatrix*, const bmatrix*) = ref_matrix_mul;
float (*volatile p_sin)(float) = ref_sin;
int (*volatile p_streq)(const char*, const char*) = ref_string_eq;

static char s1[] = "the quick brown fox jumps over!!";
static char s2[] = "the quick brown fox jumps over!!";
static bmatrix ma, mb, mc;

EXPORT int64_t ref_nop_loop(int64_t n) {
  int64_t acc = 0;
  for (int64_t i = 0; i < n; i++) {
    acc += p_nop(i);
  }
  return acc;
}

EXPORT int64_t ref_matrix_loop(int64_t n) {
  float* a = (float*)&ma;
  float* b = (float*)&mb;
  for (int i = 0; i < 16; i++) {
    a[i] = (i % 5 == 0) ? 1.0f : 0.0f;
    b[i] = 0.25f * (float)(i + 1);
  }
  for (int64_t i = 0; i < n; i++) {
    p_matrix(&mc, &ma, &mb);
  }
  float* c = (float*)&mc;
  return (int64_t)(1000.0f * (c[0] + c[15]));
}

EXPORT int64_t ref_sin_loop(int64_t n) {
  float acc = 0.0f;
  for (int64_t i = 0; i < n; i++) {
    acc += p_sin((float)i);
  }
  return (int64_t)acc;
}

EXPORT int64_t ref_string_loop(int64_t n) {
  int64_t cnt = 0;
  for (int64_t i = 0; i < n; i++) {
    if (p_streq(s1, s2)) {
      cnt++;
    }
  }
  return cnt;
}

#ifndef __wasm__
#include <stdio.h>
#include <time.h>

static double now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

static int cmp(const void* a, const void* b) {
  double x = *(const double*)a, y = *(const double*)b;
  return (x > y) - (x < y);
}

#include <stdlib.h>

int main(int argc, char** argv) {
  int reps = argc > 1 ? atoi(argv[1]) : 5;
  struct {
    const char* name;
    int64_t (*fn)(int64_t);
    int64_t n;
  } benches[] = {
      {"bench-nop-loop", ref_nop_loop, 200000000},
      {"bench-matrix-loop", ref_matrix_loop, 100000000},
      {"bench-sin-loop", ref_sin_loop, 200000000},
      {"bench-string-loop", ref_string_loop, 10000000},
  };
  printf("benchmark,iteraciones,segundos,ns_por_iter,resultado\n");
  for (int b = 0; b < 4; b++) {
    double t[32];
    int64_t result = 0;
    for (int r = 0; r < reps; r++) {
      double t0 = now();
      result = benches[b].fn(benches[b].n);
      t[r] = now() - t0;
    }
    qsort(t, (size_t)reps, sizeof(double), cmp);
    double s = t[reps / 2];
    printf("%s,%lld,%.4f,%.3f,%lld\n", benches[b].name, (long long)benches[b].n, s,
           s * 1e9 / (double)benches[b].n, (long long)result);
  }
  return 0;
}
#endif
