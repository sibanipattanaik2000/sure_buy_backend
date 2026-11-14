import { z } from "zod";

export const createOrderSchema = z.object({
  addressId: z.string().cuid("Invalid address ID"),

  paymentMethod: z.enum(["COD", "UPI", "CARD", "EMI"]),

  couponCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(40, "Invalid coupon code")
    .optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        variantId: z.number().int().positive().nullable().optional(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
});

export const orderIdSchema = z.object({
  id: z.string().cuid("Invalid order ID"),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
