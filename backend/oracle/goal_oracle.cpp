// Fase 3: oráculo nativo. Ejecuta cada caso de un fichero .cases con el x86 real de goalc,
// en el runtime de OpenGOAL (kernel de Jak 2, sin ISO), e imprime "caso => resultado".
// run_tests.mjs ejecuta los mismos casos en wasm y compara los resultados.
//
// Uso: goal-oracle <fichero.gc> <fichero.cases>

#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>
#include <thread>

#include "common/log/log.h"
#include "common/util/FileUtil.h"
#include "common/util/os.h"
#include "goalc/compiler/Compiler.h"
#include "test/goalc/framework/test_runner.h"

namespace {
std::string eval(Compiler& c, const std::string& code) {
  auto& listener = c.listener();
  listener.record_messages(ListenerMessageKind::MSG_PRINT);
  c.compile_and_send_from_string(code);
  while (listener.get_received_message_count() < 1) {
    std::this_thread::sleep_for(std::chrono::microseconds(100));
  }
  auto messages = listener.stop_recording_messages();
  std::string r = messages.empty() ? "" : messages.back();
  while (!r.empty() && (r.back() == '\n' || r.back() == '\r')) {
    r.pop_back();
  }
  return r;
}
}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "uso: %s fichero.gc fichero.cases\n", argv[0]);
    return 1;
  }
  setup_cpu_info();
  file_util::setup_project_path(std::nullopt);
  lg::initialize();

  Compiler compiler(GameVersion::Jak2, emitter::InstructionSet::X86);
  compiler.run_front_end_on_string("(build-kernel)");
  std::thread runtime(GoalTest::runtime_with_kernel_jak2);
  compiler.run_test_from_string("(set! *use-old-listener-print* #t)");
  compiler.run_test_from_string(std::string("(ml \"") + argv[1] + "\")");

  std::ifstream cases(argv[2]);
  std::string line;
  while (std::getline(cases, line)) {
    if (line.empty()) {
      continue;
    }
    printf("ORACLE %s => %s\n", line.c_str(), eval(compiler, line).c_str());
    fflush(stdout);
  }

  compiler.shutdown_target();
  runtime.join();
  return 0;
}
