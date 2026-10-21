import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env";

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {
  /** Used by tests to inject a controlled environment. */
  static forTest(overrides: Record<string, string> = {}) {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ENV, useFactory: () => loadEnv(process.env, overrides) }],
      exports: [ENV],
    };
  }
}
