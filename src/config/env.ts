import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(5000),

  FRONTEND_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),

  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
    R2_ACCOUNT_ID: z
  .string()
  .min(1, "R2_ACCOUNT_ID is required"),

R2_ACCESS_KEY_ID: z
  .string()
  .min(1, "R2_ACCESS_KEY_ID is required"),

R2_SECRET_ACCESS_KEY: z
  .string()
  .min(1, "R2_SECRET_ACCESS_KEY is required"),

R2_BUCKET_NAME: z
  .string()
  .min(1, "R2_BUCKET_NAME is required"),

R2_PUBLIC_BASE_URL: z
  .string()
  .url("R2_PUBLIC_BASE_URL must be a valid URL"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);

  process.exit(1);
}

export const env = parsedEnv.data;