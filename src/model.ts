/**
 * The vendor-neutral menu model. Every schema here is enforced with Zod, and every
 * TypeScript type is inferred from its schema, so the two can never drift apart.
 *
 * @packageDocumentation
 */
import { z } from "zod";

/** Version of the JSON shape produced by this library. Bumped on breaking changes. */
export const SCHEMA_VERSION = "1.0";

/** Broad kind of a menu item: `food`, `beverage` (non-alcoholic) or `bar` (alcoholic). */
export const ItemKindSchema = z.enum(["food", "beverage", "bar"]);
/** Broad kind of a menu item. */
export type ItemKind = z.infer<typeof ItemKindSchema>;

/** Service channels an item may carry an alternative price for. */
export const PriceVariantKeySchema = z.enum(["dineIn", "bar", "pickup", "takeout", "delivery"]);
/** A service channel with its own price. */
export type PriceVariantKey = z.infer<typeof PriceVariantKeySchema>;
/** All {@link PriceVariantKey} values, in display order. */
export const PRICE_VARIANT_KEYS = PriceVariantKeySchema.options;

/** Coarse restaurant category, useful for picking defaults downstream. */
export const RestaurantTypeSchema = z.enum([
  "pizza",
  "burger",
  "bar_grill",
  "fine_dining",
  "cafe",
  "mexican",
  "asian",
  "breakfast",
  "sandwich",
  "seafood",
  "other",
]);
/** Coarse restaurant category. */
export type RestaurantType = z.infer<typeof RestaurantTypeSchema>;
/** All {@link RestaurantType} values. */
export const RESTAURANT_TYPES = RestaurantTypeSchema.options;

/** A non-negative amount in the menu's (unmodelled) currency. */
const Money = z.number().nonnegative();

/** One choice inside a modifier section, e.g. "Bacon" for +2.00. */
export const ModifierOptionSchema = z.object({
  name: z.string().min(1),
  /** Upcharge; 0 when the option is free. */
  price: Money.default(0),
});
/** One choice inside a modifier section. */
export type ModifierOption = z.infer<typeof ModifierOptionSchema>;

/** A pick-list such as "Choose a side": how many options are required and allowed. */
export const ModifierSectionSchema = z
  .object({
    name: z.string().min(1),
    /** Minimum picks; 0 means optional. */
    min: z.number().int().nonnegative(),
    /** Maximum picks; at least 1. */
    max: z.number().int().positive(),
    options: z.array(ModifierOptionSchema).min(1),
  })
  .refine((s) => s.min <= s.max, { error: "min must not exceed max" });
/** A pick-list of modifier options. */
export type ModifierSection = z.infer<typeof ModifierSectionSchema>;

/** A named, reusable set of modifier sections that items reference by name. */
export const ModifierGroupSchema = z.object({
  name: z.string().min(1),
  sections: z.array(ModifierSectionSchema).min(1),
});
/** A named, reusable set of modifier sections. */
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

/** A single sellable item. */
export const MenuItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: ItemKindSchema,
  /** Base price. 0 means no price was found on the menu (always reported as a warning). */
  price: Money,
  /** Alternative prices per service channel; only channels the menu actually prices. */
  priceVariants: z.partialRecord(PriceVariantKeySchema, Money).optional(),
  /** Name of an entry in {@link Menu.modifierGroups}. */
  modifierGroup: z.string().optional(),
});
/** A single sellable item. */
export type MenuItem = z.infer<typeof MenuItemSchema>;

/** A menu section such as "Starters", holding items in menu order. */
export const CategorySchema = z.object({
  name: z.string().min(1),
  items: z.array(MenuItemSchema),
});
/** A menu section holding items in menu order. */
export type Category = z.infer<typeof CategorySchema>;

/** A complete extracted menu. */
export const MenuSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  restaurantName: z.string().optional(),
  restaurantType: RestaurantTypeSchema,
  /** Categories in menu order. */
  categories: z.array(CategorySchema),
  modifierGroups: z.array(ModifierGroupSchema),
});
/** A complete extracted menu. */
export type Menu = z.infer<typeof MenuSchema>;

/** What every extraction returns: the validated menu plus everything that was changed on the way. */
export interface ExtractionResult {
  menu: Menu;
  /** Every item or field that was dropped, coerced, truncated or repaired. Review these. */
  warnings: string[];
}
