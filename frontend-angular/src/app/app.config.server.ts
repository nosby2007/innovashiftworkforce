import { mergeApplicationConfig, ApplicationConfig } from "@angular/core";
import { provideServerRendering } from "@angular/ssr";
import { provideTranslocoLoader } from "@jsverse/transloco";
import { appConfig } from "./app.config";
import { TranslocoServerLoader } from "./core/i18n/transloco-server-loader";

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(), provideTranslocoLoader(TranslocoServerLoader)],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
