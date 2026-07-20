// Vercel serverless entry point. Requires the ALREADY-COMPILED Nest app
// (apps/api/dist/, produced by `nest build` during the Vercel build step) —
// not the raw TypeScript in src/ — so decorator metadata is emitted by the
// real TypeScript compiler rather than Vercel's esbuild bundler, which
// doesn't reliably reproduce the `emitDecoratorMetadata` output NestJS's
// dependency injection relies on.
//
// main.ts (used by `pnpm dev` / Docker) is untouched; this file duplicates
// its bootstrap so the two entry points can diverge (e.g. no app.listen()
// here — Vercel owns the request lifecycle) without conditionals in either.
const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const { ValidationPipe } = require('@nestjs/common');
const express = require('express');
const helmet = require('helmet');
const { AppModule } = require('../dist/app.module');

const server = express();
let bootstrapPromise;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, corsOrigins.includes(origin));
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
}

module.exports = async (req, res) => {
  if (!bootstrapPromise) bootstrapPromise = bootstrap();
  await bootstrapPromise;
  server(req, res);
};
