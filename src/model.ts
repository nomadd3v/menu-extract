import { z } from "zod";

/** Broad kind of an item. */
export const ItemKind = z.enum(["food", "beverage", "bar"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const PRICE_VARIANT_KEYS = ["dineIn", "bar", "pickup", "takeout", "delivery"] as const;
export type PriceVariantKey = (typeof PRICE_VARIANT_KEYS)[number];

export const RESTAURANT_TYPES = [
  "pizza", "burger", "bar_grill", "fine_dining", "cafe", "mexican",
  "asian", "breakfast", "sandwich", "seafood", "other",
] as const;

const Money = z.number().finite().nonnegative();

export const ModifierOptionSchema = z.object({
  name: z.string().min(1),
  /** Upcharge in the menu currency; 0 when there is no extra cost. */
  price: Money.default(0),
});

export const ModifierSectionSchema = z
  .object({
    name: z.string().min(1),
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    options: z.array(ModifierOptionSchema).min(1),
  })
  .refine((s) => s.min <= s.max, { message: "min must not exceed max" });

export const ModifierGroupSchema = z.object({
  name: z.string().min(1),
  sections: z.array(ModifierSectionSchema).min(1),
});

export const MenuItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: ItemKind,
  /** Base price. 0 means "no price found on the menu". */
  price: Money,
  /** Optional alternative prices (e.g. a different dine-in or delivery price). */
  priceVariants: z
    .object({
      dineIn: Money.optional(),
      bar: Money.optional(),
      pickup: Money.optional(),
      takeout: Money.optional(),
      delivery: Money.optional(),
    })
    .optional(),
  /** Name of an entry in `Menu.modifierGroups`. */
  modifierGroup: z.string().optional(),
});

export const CategorySchema = z.object({
  name: z.string().min(1),
  items: z.array(MenuItemSchema),
});

export const MenuSchema = z.object({
  schemaVersion: z.literal("1.0"),
  restaurantName: z.string().optional(),
  restaurantType: z.enum(RESTAURANT_TYPES),
  categories: z.array(CategorySchema),
  modifierGroups: z.array(ModifierGroupSchema),
});

export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Menu = z.infer<typeof MenuSchema>;

export interface ExtractionResult {
  menu: Menu;
  /** Everything that was dropped, coerced or repaired while validating. */
  warnings: string[];
}
