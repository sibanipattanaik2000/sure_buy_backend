import { z } from "zod";

export const addCartItemSchema = z.object({
  productId: z.coerce
    .number()
    .int()
    .positive("Product ID must be a positive integer"),

  variantId: z
    .union([
      z.coerce.number().int().positive(),
      z.null(),
    ])
    .optional(),

  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1")
    .max(99, "Quantity cannot exceed 99")
    .default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1")
    .max(99, "Quantity cannot exceed 99"),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;