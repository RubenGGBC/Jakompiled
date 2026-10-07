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

#include "common/log/log.h"
#include "common/util/FileUtil.h"
#include "common/util/os.h"
#include "goalc/compiler/Compiler.h"
#include "test/goalc/framework/test_runner.h"

namespace {

struct Bench {
  const char* name;
  long long n;
};

// Compila la expresión, la envía al runtime y espera al resultado que imprime el
// listener. Devuelve el tiempo desde el envío hasta el resultado.
double run_seconds(Compiler& c, const std::string& code, std::string* result) {
  auto& listener = c.listener();
  listener.record_messages(ListenerMessageKind::MSG_PRINT);
  auto t0 = std::chrono::steady_clock::now();
  c.compile_and_send_from_string(code);
  while (listener.get_received_message_count() < 1) {
    std::this_thread::sleep_for(std::chrono::microseconds(100));
  }
  auto t1 = std::chrono::steady_clock::now();
  auto messages = listener.stop_recording_messages();
  if (result) {
    *result = messages.empty() ? "" : messages.back();
    while (!result->empty() && (result->back() == '\n' || result->back() == '\r')) {
      result->pop_back();
    }
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

  setup_cpu_info();
  file_util::setup_project_path(std::nullopt);
  lg::initialize();

  Compiler compiler(GameVersion::Jak2, emitter::InstructionSet::X86);
  compiler.run_front_end_on_string("(build-kernel)");
  std::thread runtime(GoalTest::runtime_with_kernel_jak2);
  compiler.run_test_from_string("(set! *use-old-listener-print* #t)");
  compiler.run_test_from_string("(ml \"" + bench_file + "\")");
  // calentamiento
  run_seconds(compiler, "(bench-nop-loop 1000)", nullptr);

  const std::vector<Bench> benches = {
      {"bench-nop-loop", 200000000LL},
      {"bench-matrix-loop", 100000000LL},
      {"bench-sin-loop", 200000000LL},
      {"bench-string-loop", 10000000LL},
  };

  printf("benchmark,iteraciones,segundos,ns_por_iter,resultado\n");
  for (const auto& b : benches) {
    // pendiente entre n y 2n: elimina el coste fijo de compilar, enviar y responder
    std::vector<double> t1, t2;
    std::string result;
    for (int r = 0; r < reps; r++) {
      t1.push_back(run_seconds(compiler, fmt::format("({} {})", b.name, b.n), &result));
      t2.push_back(run_seconds(compiler, fmt::format("({} {})", b.name, 2 * b.n), nullptr));
    }
    double secs = median(t2) - median(t1);
    printf("%s,%lld,%.4f,%.3f,%s\n", b.name, b.n, secs, secs * 1e9 / double(b.n),
           result.c_str());
    fflush(stdout);
  }

  compiler.shutdown_target();
  runtime.join();
  return 0;
}
