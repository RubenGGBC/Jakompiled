// Fase 1: arranca el kernel GOAL de Jak 2 (sin ISO), carga bench.gc con goalc
// y mide cada bucle de benchmark ejecutado por el runtime nativo.
//
// Se compila dentro del árbol de jak-project (ver bench/fase1/README.md).
// Uso: goal-bench <ruta a bench.gc> [repeticiones]

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

#include "goalc/compiler/Compiler.h"
#include "test/goalc/framework/test_runner.h"

namespace {

struct Bench {
  const char* name;
  long long n;
};

double run_seconds(Compiler& c, const std::string& code, std::string* result) {
  auto t0 = std::chrono::steady_clock::now();
  auto out = c.run_test_from_string(code);
  auto t1 = std::chrono::steady_clock::now();
  if (result) {
    *result = out.empty() ? "" : out.back();
  }
  return std::chrono::duration<double>(t1 - t0).count();
}

double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "uso: %s bench.gc [reps]\n", argv[0]);
    return 1;
  }
  const std::string bench_file = argv[1];
  const int reps = argc > 2 ? std::stoi(argv[2]) : 5;

  Compiler compiler(GameVersion::Jak2, emitter::InstructionSet::X86);
  compiler.run_front_end_on_string("(build-kernel)");
  std::thread runtime(GoalTest::runtime_with_kernel_jak2);
  compiler.run_test_from_string("(set! *use-old-listener-print* #t)");
  compiler.run_test_from_string("(ml \"" + bench_file + "\")");

  const std::vector<Bench> benches = {
      {"bench-nop-loop", 200000000LL},
      {"bench-matrix-loop", 100000000LL},
      {"bench-sin-loop", 200000000LL},
      {"bench-string-loop", 10000000LL},
  };

  printf("benchmark,iteraciones,segundos,ns_por_iter,resultado\n");
  for (const auto& b : benches) {
    // coste fijo de compilar y enviar la expresión, medido con n = 0
    std::vector<double> base, full;
    std::string result;
    for (int r = 0; r < reps; r++) {
      base.push_back(run_seconds(compiler, fmt::format("({} 0)", b.name), nullptr));
      full.push_back(run_seconds(compiler, fmt::format("({} {})", b.name, b.n), &result));
    }
    double secs = median(full) - median(base);
    printf("%s,%lld,%.4f,%.3f,%s\n", b.name, b.n, secs, secs * 1e9 / double(b.n),
           result.c_str());
    fflush(stdout);
  }

  compiler.shutdown_target();
  runtime.join();
  return 0;
}
