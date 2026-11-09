import { newPlanCategories } from "./mealPlanNew";

// Malcolm's meal plan from Tristan Marais: 2400 kcal a day (protein 176 g,
// carbs 293 g, fat 55 g - 30/50/20) - every meal from both versions of the
// plan, as options. One meal from each category a day;
// the post-workout snack only after training, on training days.
//
// Each ingredient names the shopping item it comes from (so the same item
// across meals adds up on the shopping list), its weight as the plan gives
// it (raw or cooked as stated), and the shop section it's found in.
// "To taste" items (herbs, spices, cooking spray) carry no weight.

export type Section = "Meat & fish" | "Fruit & veg" | "Dairy & eggs" | "Bakery" | "Cupboard" | "Frozen" | "Drinks" | "Herbs, spices & extras";

export const SECTIONS: Section[] = ["Meat & fish", "Fruit & veg", "Dairy & eggs", "Bakery", "Cupboard", "Frozen", "Drinks", "Herbs, spices & extras"];

export interface Ingredient {
  /** The shopping item - meals sharing one add up. */
  item: string;
  /** Grams, as the plan states them; none for "to taste". */
  g?: number;
  /** How it's weighed or bought, e.g. "cooked weight", "uncooked". */
  as?: string;
  /** Amount in words where there's no weight ("1-2 tsp"). */
  amount?: string;
  section: Section;
}

export interface Meal {
  id: string;
  name: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  prepMin?: number;
  cookMin?: number;
  ingredients: Ingredient[];
  method?: string[];
  /** Part of the plan's page wasn't readable - the list may be short. */
  incomplete?: boolean;
}

export type CategoryId = "post" | "breakfast" | "lunch" | "snack" | "dinner";

export interface Category {
  id: CategoryId;
  name: string;
  /** The plan's target for the category. */
  kcal: number;
  /** Training days only. */
  trainingOnly?: boolean;
  meals: Meal[];
}

export const DAILY = { kcal: 2400, protein: 176, carbs: 293, fat: 55 };

const CHICKEN = "Chicken breast fillet pieces";
const WHEY = "Whey protein powder";
const COCONUT_OIL = "Coconut oil";

export const MEAL_PLAN: Category[] = [
  {
    id: "post",
    name: "Post-workout snack",
    kcal: 440,
    trainingOnly: true,
    meals: [
      {
        id: "rice-krispies-shake",
        name: "Rice Krispies with protein shake",
        kcal: 440,
        protein: 30,
        carbs: 54,
        fat: 11,
        prepMin: 5,
        ingredients: [
          { item: "Almond drink, unsweetened (Almond Breeze)", g: 195, section: "Drinks" },
          { item: "Rice Krispies (Kellogg's)", g: 60, section: "Cupboard" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
          { item: "Whole almonds", g: 10, as: "raw, with skin", section: "Cupboard" },
        ],
      },
      {
        id: "cornflakes-protein",
        name: "Cornflakes with protein drink",
        kcal: 440,
        protein: 30,
        carbs: 55,
        fat: 10,
        prepMin: 5,
        ingredients: [
          { item: "Almond butter (100% almonds)", g: 10, section: "Cupboard" },
          { item: "Almond milk, unsweetened", g: 145, section: "Drinks" },
          { item: "Cornflakes", g: 60, section: "Cupboard" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
        ],
        method: ["Mix the milk and protein powder.", "Add the cornflakes to a bowl, then add the protein drink and top with nut butter."],
      },
      {
        id: "chicken-sandwich",
        name: "Sandwich with chicken",
        kcal: 436,
        protein: 30,
        carbs: 64,
        fat: 6,
        prepMin: 5,
        cookMin: 10,
        ingredients: [
          { item: "Sourdough bread, sliced", g: 130, section: "Bakery" },
          { item: CHICKEN, g: 85, as: "cooked, ready to eat", section: "Meat & fish" },
        ],
        method: [
          "Rinse and slice the chicken.",
          "Heat a nonstick pan over medium heat. Cook the chicken, season with salt and pepper, for 3 minutes or until ready.",
          "Toast the bread if desired.",
          "Make a sandwich with the toasted bread and chicken slices.",
        ],
      },
    ],
  },
  {
    id: "breakfast",
    name: "Breakfast",
    kcal: 465,
    meals: [
      {
        id: "breakfast-overnight-oats",
        name: "Raspberry or blueberry and dark chocolate overnight oats",
        kcal: 464,
        protein: 34,
        carbs: 56,
        fat: 11,
        prepMin: 5,
        ingredients: [
          { item: "Oats", g: 85, section: "Cupboard" },
          { item: "Raspberries (any berries)", g: 45, as: "or blueberries", section: "Fruit & veg" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
          { item: "Dark chocolate, 70%", g: 5, section: "Cupboard" },
        ],
        method: [
          "Make it the night before: it needs at least 4 hours in the fridge.",
          "Rinse the berries and chop the chocolate. Mix the oats and protein powder in a bowl with hot water, stirring well. Let it cool, then add the chocolate and berries.",
          "Cover and refrigerate overnight, or for at least 4 hours.",
        ],
      },
      {
        id: "special-k",
        name: "Special K with protein milk and dark choc",
        kcal: 469,
        protein: 32,
        carbs: 59,
        fat: 11,
        prepMin: 5,
        ingredients: [
          { item: "Almond drink, unsweetened (Almond Breeze)", g: 310, section: "Drinks" },
          { item: "Special K, Original (Kellogg's)", g: 65, section: "Cupboard" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
          { item: "Dark chocolate, 70%", g: 10, section: "Cupboard" },
        ],
        method: ["Mix the protein powder with the milk until there are no lumps.", "Pour the cereal into a bowl and top with the protein milk and dark choc."],
      },
      {
        id: "breakfast-chicken-egg-sandwich",
        name: "Sandwich with chicken and egg",
        kcal: 459,
        protein: 33,
        carbs: 59,
        fat: 10,
        prepMin: 5,
        cookMin: 10,
        ingredients: [
          { item: "Sourdough bread, sliced", g: 120, section: "Bakery" },
          { item: CHICKEN, g: 75, as: "cooked, ready to eat", section: "Meat & fish" },
          { item: "Eggs", g: 45, as: "whole - about 1 small egg", section: "Dairy & eggs" },
        ],
        method: [
          "Rinse and slice the chicken.",
          "Heat a nonstick pan over medium heat. Cook the chicken, season with salt and pepper, for 3 minutes or until ready. Cook the egg.",
          "Toast the bread if desired.",
          "Make a sandwich with the toasted bread, chicken slices and egg.",
        ],
      },
      {
        id: "protein-yoghurt",
        name: "Protein yoghurt",
        kcal: 468,
        protein: 36,
        carbs: 54,
        fat: 11,
        prepMin: 10,
        ingredients: [
          { item: "Apples", g: 230, section: "Fruit & veg" },
          { item: "Yoghurt, 0% fat (Campina mager)", g: 170, section: "Dairy & eggs" },
          { item: "Strawberries", g: 205, as: "frozen", section: "Frozen" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
          { item: "Whole almonds", g: 15, as: "raw, with skin", section: "Cupboard" },
        ],
      },
    ],
  },
  {
    id: "lunch",
    name: "Lunch",
    kcal: 490,
    meals: [
      {
        id: "chicken-broccoli-potatoes",
        name: "Chicken with broccoli and potatoes",
        kcal: 487,
        protein: 34,
        carbs: 61,
        fat: 11,
        prepMin: 10,
        cookMin: 30,
        ingredients: [
          { item: CHICKEN, g: 105, as: "cooked, ready to eat", section: "Meat & fish" },
          { item: "Potatoes", g: 335, as: "medium", section: "Fruit & veg" },
          { item: "Broccoli", g: 90, section: "Fruit & veg" },
          { item: COCONUT_OIL, g: 5, section: "Cupboard" },
        ],
        method: [
          "Boil the potatoes (peeled or not, halved if large) in lightly salted water for 15-30 minutes until soft.",
          "Fry the chicken on all sides in the oil on a medium-high heat until golden and cooked through, but not dry.",
          "Cut the broccoli into florets and boil for about 3 minutes until tender.",
          "Serve the potatoes, broccoli and chicken together.",
        ],
      },
      {
        id: "bagel-chicken-mayo",
        name: "Bagel with chicken and mayo",
        kcal: 482,
        protein: 33,
        carbs: 62,
        fat: 11,
        prepMin: 5,
        cookMin: 15,
        ingredients: [
          { item: "Mayonnaise, light", g: 10, as: "26-28% fat", section: "Cupboard" },
          { item: "Multigrain bagels", g: 130, section: "Bakery" },
          { item: CHICKEN, g: 85, as: "cooked, ready to eat", section: "Meat & fish" },
        ],
        method: [
          "Split the bagel and toast until golden.",
          "Season the chicken with salt and pepper and fry on a medium-high heat until no longer pink in the middle. Slice.",
          "Put the mayo and sliced chicken on the toasted bagel.",
        ],
      },
      {
        id: "pasta-bolognese",
        name: "Classic pasta Bolognese",
        kcal: 490,
        protein: 36,
        carbs: 57,
        fat: 12,
        prepMin: 5,
        cookMin: 15,
        ingredients: [
          { item: "Chopped tomatoes, tinned", g: 210, section: "Cupboard" },
          { item: "Lean beef steak mince (3-7% fat)", g: 95, as: "cooked weight", section: "Meat & fish" },
          { item: "Whole wheat pasta", g: 75, as: "uncooked", section: "Cupboard" },
          { item: COCONUT_OIL, g: 5, section: "Cupboard" },
        ],
        method: [
          "Cook the pasta according to the packet in lightly salted water.",
          "Fry the mince in the oil on a medium-high heat until browned. Add the tomatoes, season, and simmer for 10-15 minutes.",
          "Serve the pasta with the sauce.",
        ],
      },
      {
        id: "tomato-mozzarella-crispbread",
        name: "Tomato and mozzarella on crispbread",
        kcal: 492,
        protein: 33,
        carbs: 61,
        fat: 12,
        prepMin: 5,
        ingredients: [
          { item: "Tomatoes", g: 115, section: "Fruit & veg" },
          { item: "Mozzarella light (8-9% fat)", g: 125, section: "Dairy & eggs" },
          { item: "Crispbread, Sport (Wasa)", g: 75, section: "Bakery" },
          { item: "Balsamic glaze", g: 15, section: "Cupboard" },
        ],
        method: ["Rinse and slice the tomato. Slice the mozzarella.", "Put them on the crispbread and top with balsamic glaze."],
      },
    ],
  },
  {
    id: "snack",
    name: "Snack 1",
    kcal: 520,
    meals: [
      {
        id: "chicken-sweet-potato-avo",
        name: "Chicken, sweet potato and avo",
        kcal: 523,
        protein: 40,
        carbs: 61,
        fat: 13,
        prepMin: 5,
        ingredients: [
          { item: CHICKEN, g: 150, as: "cooked, ready to eat", section: "Meat & fish" },
          { item: "Sweet potatoes", g: 330, as: "raw", section: "Fruit & veg" },
          { item: "Avocado", g: 40, as: "flesh only", section: "Fruit & veg" },
        ],
      },
      {
        id: "chicken-potato",
        name: "Chicken and potato",
        kcal: 518,
        protein: 36,
        carbs: 64,
        fat: 12,
        prepMin: 5,
        ingredients: [
          { item: CHICKEN, g: 130, as: "cooked, ready to eat", section: "Meat & fish" },
          { item: "Potatoes", g: 360, as: "medium", section: "Fruit & veg" },
          { item: COCONUT_OIL, g: 5, section: "Cupboard" },
        ],
      },
      {
        id: "berry-oats",
        name: "Berry and dark chocolate overnight oats",
        kcal: 518,
        protein: 38,
        carbs: 62,
        fat: 12,
        prepMin: 5,
        ingredients: [
          { item: "Oats", g: 95, section: "Cupboard" },
          { item: "Raspberries (any berries)", g: 55, section: "Fruit & veg" },
          { item: WHEY, g: 30, as: "flavoured", section: "Cupboard" },
          { item: "Dark chocolate, 70%", g: 10, section: "Cupboard" },
        ],
        method: [
          "Make it the night before: it needs at least 4 hours in the fridge.",
          "Rinse the berries and chop the chocolate. Mix the oats and protein powder in a bowl with hot water, stirring well. Let it cool, then add the chocolate and berries.",
          "Cover and refrigerate overnight, or for at least 4 hours.",
        ],
      },
    ],
  },
  {
    id: "dinner",
    name: "Dinner",
    kcal: 500,
    meals: [
      {
        id: "baked-salmon",
        name: "Baked salmon, honey-glazed",
        kcal: 500,
        protein: 37,
        carbs: 63,
        fat: 10,
        prepMin: 15,
        cookMin: 20,
        ingredients: [
          { item: COCONUT_OIL, g: 5, section: "Cupboard" },
          { item: "Sweet potatoes", g: 325, as: "with skin, cooked/baked weight", section: "Fruit & veg" },
          { item: "Salmon fillets (wild Alaskan Pacific)", g: 130, as: "cooked weight", section: "Meat & fish" },
          { item: "Honey", g: 5, section: "Cupboard" },
          { item: "Garlic powder", amount: "1/2-1 tsp", section: "Herbs, spices & extras" },
          { item: "Coriander, fresh", amount: "1/4-1/2 handful", section: "Herbs, spices & extras" },
          { item: "Smoked paprika", amount: "1/2-1 tsp", section: "Herbs, spices & extras" },
          { item: "Lemon juice", amount: "1/2-1 tbsp", section: "Herbs, spices & extras" },
          { item: "Ground cumin", amount: "1/2-1 tsp", section: "Herbs, spices & extras" },
          { item: "Balsamic vinegar", amount: "1 tbsp", section: "Herbs, spices & extras" },
        ],
      },
      {
        id: "salmon-pasta-lime",
        name: "Salmon pasta with lime",
        kcal: 495,
        protein: 36,
        carbs: 60,
        fat: 11,
        prepMin: 5,
        cookMin: 10,
        ingredients: [
          { item: "Pasta", g: 65, as: "uncooked", section: "Cupboard" },
          { item: "Crème fraîche / sour cream (9% fat)", g: 80, section: "Dairy & eggs" },
          { item: "Salmon fillets (wild Alaskan Pacific)", g: 120, as: "raw weight", section: "Meat & fish" },
          { item: "Honey", g: 10, section: "Cupboard" },
          { item: "Stock cubes", amount: "1/2-2 cubes", section: "Herbs, spices & extras" },
          { item: "Limes", amount: "1-2 tsp zest, 1-3 tbsp juice", section: "Fruit & veg" },
        ],
        method: [
          "Cook the pasta as the packet says.",
          "Cube the salmon. In a saucepan mix the crème fraîche, crumbled stock cube, honey, lime zest and juice; thin with water into a sauce and bring to the boil over low heat.",
          "Add the salmon and cook 2-3 minutes. Serve with the pasta, season with salt and pepper.",
        ],
      },
      {
        id: "salmon-smash-burger",
        name: "Salmon smash burger on a bagel",
        kcal: 495,
        protein: 36,
        carbs: 59,
        fat: 12,
        prepMin: 10,
        cookMin: 10,
        ingredients: [
          { item: "Salmon fillets (wild Alaskan Pacific)", g: 100, as: "raw weight", section: "Meat & fish" },
          { item: "Breadcrumbs / panko", g: 10, section: "Cupboard" },
          { item: "Avocado", g: 40, as: "flesh only", section: "Fruit & veg" },
          { item: "Whole wheat bagels (Thomas')", g: 110, section: "Bakery" },
          { item: "Garlic powder", amount: "1-2 tsp", section: "Herbs, spices & extras" },
          { item: "Cooking spray", amount: "2-3 seconds", section: "Herbs, spices & extras" },
          { item: "Shallots", amount: "1-2", section: "Fruit & veg" },
          { item: "Dill, fresh", amount: "1-2 tsp chopped", section: "Herbs, spices & extras" },
        ],
        method: [
          "Finely chop the salmon into a mince. Halve the avocado, remove the stone and slice the flesh.",
          "Mix the shallot, breadcrumbs, dill, salt, pepper and garlic powder into the salmon and shape into equal patties.",
          "Heat a pan at medium-high with the cooking spray. Press the patties down firmly and cook 4-5 minutes a side until golden.",
          "Toast the bagel if desired, then add the avocado and patties.",
        ],
      },
      {
        id: "bagel-salmon-cottage",
        name: "Bagel with salmon and cottage cheese",
        kcal: 495,
        protein: 38,
        carbs: 61,
        fat: 10,
        prepMin: 10,
        cookMin: 5,
        ingredients: [
          { item: "Cottage cheese, low fat", g: 100, section: "Dairy & eggs" },
          { item: "Whole wheat bagels (Thomas')", g: 125, section: "Bakery" },
          { item: "Smoked salmon, slices", g: 60, section: "Meat & fish" },
        ],
        method: [
          "Slice the bagel in half and toast until golden.",
          "Add some cottage cheese and salmon on top.",
          "Season with salt, pepper and any herbs or spices. Eat the rest of the cottage cheese on the side.",
        ],
      },
      {
        id: "steak-wrap",
        name: "Steak wrap",
        kcal: 497,
        protein: 37,
        carbs: 58,
        fat: 12,
        prepMin: 5,
        cookMin: 20,
        ingredients: [
          { item: "Cheese, 16% fat (any type)", g: 20, section: "Dairy & eggs" },
          { item: "Sirloin steak, lean", g: 110, as: "raw weight", section: "Meat & fish" },
          { item: "Wholemeal tortillas", g: 105, section: "Bakery" },
        ],
      },
      {
        id: "steak-rice-beans",
        name: "Steak, rice and green beans",
        kcal: 495,
        protein: 35,
        carbs: 59,
        fat: 12,
        prepMin: 5,
        cookMin: 20,
        ingredients: [
          { item: "Basmati rice", g: 65, as: "uncooked", section: "Cupboard" },
          { item: COCONUT_OIL, g: 5, section: "Cupboard" },
          { item: "Green beans", g: 90, as: "frozen", section: "Frozen" },
          { item: "Sirloin steak, lean", g: 125, as: "raw weight", section: "Meat & fish" },
        ],
        method: [
          "Rinse the rice and cook in lightly salted water as the packet says.",
          "Boil the green beans in salted water for about 3 minutes until a fork goes through.",
          "Cut the beef into 2 cm slices and brown in the oil on a high heat, then lower the heat and fry each side, keeping it pink in the middle. Season and rest 5 minutes.",
          "Serve the rice and beans with the steak.",
        ],
      },
      {
        id: "omelette-spinach-crispbread",
        name: "Omelette with spinach and crispbread",
        kcal: 495,
        protein: 35,
        carbs: 60,
        fat: 12,
        prepMin: 5,
        cookMin: 15,
        ingredients: [
          { item: "Apples", g: 230, section: "Fruit & veg" },
          { item: "Egg whites, pasteurised", g: 135, section: "Dairy & eggs" },
          { item: "Tomatoes", g: 130, section: "Fruit & veg" },
          { item: "Turkey slices (cold cut)", g: 65, section: "Meat & fish" },
          { item: "Avocado", g: 55, as: "flesh only", section: "Fruit & veg" },
          { item: "Crispbread, Husman (Wasa)", g: 40, section: "Bakery" },
          { item: "Spinach", g: 25, section: "Fruit & veg" },
        ],
      },
    ],
  },
];

// --- The plans ----------------------------------------------------------------


export interface Plan {
  id: string;
  name: string;
  /** For the day's plan picker. */
  short: string;
  daily: { kcal: number; protein: number; carbs: number; fat: number };
  categories: Category[];
}

/**
 * Every version of the plan Tristan has written: the original 2400 kcal one,
 * and the newer one at 2400 and 2550 kcal (the same meals, bigger portions).
 */
export const PLANS: Plan[] = [
  { id: "original", name: "Original plan · 2400 kcal", short: "Original 2400", daily: DAILY, categories: MEAL_PLAN },
  {
    id: "new-2400",
    name: "New plan · 2400 kcal",
    short: "New 2400",
    daily: { kcal: 2400, protein: 176, carbs: 293, fat: 55 },
    categories: newPlanCategories(0, "n2400", { post: 505, breakfast: 475, lunch: 505, snack: 470, dinner: 455 }),
  },
  {
    id: "new-2550",
    name: "New plan · 2550 kcal",
    short: "New 2550",
    daily: { kcal: 2550, protein: 187, carbs: 311, fat: 58 },
    categories: newPlanCategories(1, "n2550", { post: 535, breakfast: 505, lunch: 535, snack: 500, dinner: 485 }),
  },
];

/** The rest days in Malcolm's exercise plan: Thursday and Sunday. Every other day is a training day. */
export const REST_DAYS = new Set(["thu", "sun"]);
