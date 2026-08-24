import { z } from "zod";

export const createAddressSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name is too long"),

  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),

  addressLine1: z
    .string()
    .trim()
    .min(5, "Address must be at least 5 characters")
    .max(200, "Address is too long"),

  addressLine2: z
    .string()
    .trim()
    .max(200, "Address is too long")
    .optional(),

  city: z
    .string()
    .trim()
    .min(2, "City is required")
    .max(100),

  state: z
    .string()
    .trim()
    .min(2, "State is required")
    .max(100),

  postalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter a valid 6-digit postal code"),

  country: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .default("India"),

  landmark: z
    .string()
    .trim()
    .max(150)
    .optional(),

  isDefault: z.boolean().optional().default(false),
});

export const updateAddressSchema = createAddressSchema.partial();

export const addressIdSchema = z.object({
  id: z.string().cuid("Invalid address ID"),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;