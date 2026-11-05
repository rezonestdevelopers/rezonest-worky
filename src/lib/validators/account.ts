import { z } from "zod";
import { optionalPhone } from "./common";

/** One rule for every new password: resetting, choosing one when invited, or changing it. */
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(200, "That password is too long.")
  .regex(/[a-zA-Z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

export const changePasswordSchema = z
  .object({ current: z.string().min(1, "Enter your current password").max(200), next: passwordSchema, confirm: z.string().max(200) })
  .superRefine((p, ctx) => {
    if (p.next !== p.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "The two passwords don't match" });
    if (p.next === p.current) ctx.addIssue({ code: "custom", path: ["next"], message: "Choose a password different from your current one" });
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: optionalPhone,
  dailyDigest: z.boolean(),
  emailOnTask: z.boolean(),
});
export type ProfileInput = z.input<typeof profileSchema>;
