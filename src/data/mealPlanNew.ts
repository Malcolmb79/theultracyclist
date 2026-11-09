import type { Category, CategoryId, Ingredient, Meal, Section } from "./mealPlan";

// Tristan's newer plan, which comes in two sizes - 2400 kcal and 2550 kcal -
// with the same meals and portions scaled up for the larger one. Written
// once here, each weight as [2400, 2550], and built into both plans.

type Two = [number, number];
type NewIngredient = Omit<Ingredient, "g"> & { g?: Two };
interface NewMeal {
  id: string;
  name: string;
  kcal: Two;
  protein: Two;
  carbs: Two;
  fat: Two;
  prepMin?: number;
  cookMin?: number;
  ingredients: NewIngredient[];
  method?: string[];
}

const CHICKEN = "Chicken breast fillet pieces";
const WHEY = "Whey protein powder";
const PROTEIN = "Protein powder";
const COCONUT_OIL = "Coconut oil";
const TUNA = "Tuna in water, tinned";
const ALMOND_BUTTER = "Almond butter (100% almonds)";
const WEETBIX = "Weet-Bix, gluten free (Sanitarium)";
const s = (x: Section) => x;

const MEALS: Record<CategoryId, NewMeal[]> = {
  post: [
    {
      id: "bagel-whey-spread",
      name: "Bagel with whey spread",
      kcal: [500, 532],
      protein: [40, 42],
      carbs: [65, 69],
      fat: [8, 8],
      prepMin: 5,
      ingredients: [
        { item: "Plain bagels", g: [115, 125], section: s("Bakery") },
        { item: "Yoghurt, natural (3.6-3.8% fat)", g: [100, 110], section: s("Dairy & eggs") },
        { item: WHEY, g: [35, 35], as: "flavoured", section: s("Cupboard") },
      ],
      method: ["Mix the whey and yoghurt and spread it on the bagel."],
    },
    {
      id: "protein-yoghurt-post",
      name: "Protein yoghurt",
      kcal: [500, 532],
      protein: [43, 45],
      carbs: [70, 75],
      fat: [4, 5],
      prepMin: 10,
      ingredients: [
        { item: "Apples", g: [305, 325], section: s("Fruit & veg") },
        { item: "Strawberries", g: [270, 285], as: "frozen", section: s("Frozen") },
        { item: "Yoghurt, 0% fat (Campina mager)", g: [225, 235], section: s("Dairy & eggs") },
        { item: WHEY, g: [40, 45], as: "flavoured", section: s("Cupboard") },
      ],
    },
    {
      id: "rice-krispies-shake",
      name: "Protein shake with Rice Krispies",
      kcal: [500, 532],
      protein: [41, 44],
      carbs: [72, 76],
      fat: [4, 4],
      prepMin: 5,
      ingredients: [
        { item: "Skimmed milk (0.4-0.5% fat)", g: [240, 255], section: s("Dairy & eggs") },
        { item: "Rice Krispies (Kellogg's)", g: [70, 70], section: s("Cupboard") },
        { item: WHEY, g: [35, 40], as: "any flavour", section: s("Cupboard") },
      ],
    },
  ],
  breakfast: [
    {
      id: "scrambled-egg-banana",
      name: "Toasted bread with scrambled egg and banana",
      kcal: [468, 497],
      protein: [36, 38],
      carbs: [56, 59],
      fat: [11, 11],
      prepMin: 5,
      cookMin: 5,
      ingredients: [
        { item: "Eggs", g: [95, 100], as: "whole - about 2", section: s("Dairy & eggs") },
        { item: "Wholemeal bread", g: [30, 35], section: s("Bakery") },
        { item: "Bananas", g: [180, 195], as: "peeled", section: s("Fruit & veg") },
        { item: "Egg whites, pasteurised", g: [190, 200], section: s("Dairy & eggs") },
      ],
      method: [
        "Toast the bread.",
        "Whisk the eggs and egg whites with salt and pepper, pour into a pan and stir until set with no liquid egg left.",
        "Peel and slice the banana.",
        "Put the scrambled egg on the toast and eat the banana on the side.",
      ],
    },
    {
      id: "porridge-blueberries",
      name: "Porridge with blueberries and protein powder",
      kcal: [473, 502],
      protein: [34, 36],
      carbs: [55, 58],
      fat: [12, 13],
      prepMin: 5,
      cookMin: 5,
      ingredients: [
        { item: ALMOND_BUTTER, g: [10, 10], section: s("Cupboard") },
        { item: "Oats", g: [80, 85], section: s("Cupboard") },
        { item: "Blueberries", g: [55, 60], section: s("Fruit & veg") },
        { item: WHEY, g: [25, 30], as: "vanilla recommended", section: s("Cupboard") },
      ],
      method: [
        "Put the oats in a pot with at least twice as much water and a pinch of salt. Bring to the boil, then simmer about 3 minutes, stirring, adding water for a thinner porridge.",
        "Off the heat, stir in the protein powder until there are no lumps.",
        "Serve topped with the blueberries.",
      ],
    },
    {
      id: "tomato-tuna-toast",
      name: "Toasted bread with grated tomato and tuna",
      kcal: [477, 507],
      protein: [33, 35],
      carbs: [59, 63],
      fat: [12, 12],
      prepMin: 5,
      ingredients: [
        { item: COCONUT_OIL, g: [5, 5], section: s("Cupboard") },
        { item: "Wholemeal bread", g: [135, 145], section: s("Bakery") },
        { item: "Tomatoes", g: [105, 110], section: s("Fruit & veg") },
        { item: TUNA, g: [80, 85], section: s("Cupboard") },
      ],
      method: [
        "Rinse and grate the tomato, season with salt and pepper, and drizzle with the oil.",
        "Toast the bread and drain the tuna.",
        "Top the bread with the grated tomato and tuna.",
      ],
    },
    {
      id: "weetabix-breakfast",
      name: "Weetabix with protein",
      kcal: [473, 502],
      protein: [36, 38],
      carbs: [58, 62],
      fat: [10, 10],
      prepMin: 5,
      ingredients: [
        { item: ALMOND_BUTTER, g: [10, 10], section: s("Cupboard") },
        { item: WEETBIX, g: [80, 85], section: s("Cupboard") },
        { item: WHEY, g: [35, 35], as: "flavoured", section: s("Cupboard") },
      ],
    },
  ],
  lunch: [
    {
      id: "pasta-bolognese",
      name: "Classic pasta Bolognese",
      kcal: [503, 534],
      protein: [38, 40],
      carbs: [56, 59],
      fat: [14, 14],
      prepMin: 5,
      cookMin: 15,
      ingredients: [
        { item: "Chopped tomatoes, tinned", g: [240, 255], section: s("Cupboard") },
        { item: "Lean beef steak mince (3-7% fat)", g: [100, 105], as: "cooked weight", section: s("Meat & fish") },
        { item: "Whole wheat pasta", g: [70, 75], as: "uncooked", section: s("Cupboard") },
        { item: COCONUT_OIL, g: [5, 5], section: s("Cupboard") },
      ],
      method: [
        "Cook the pasta as the packet says in lightly salted water.",
        "Brown the mince in the oil on a medium-high heat, add the tomatoes, season and simmer 10-15 minutes.",
        "Serve the pasta with the sauce.",
      ],
    },
    {
      id: "egg-fried-rice",
      name: "Egg fried rice with corn",
      kcal: [504, 535],
      protein: [38, 41],
      carbs: [59, 63],
      fat: [12, 13],
      prepMin: 5,
      cookMin: 20,
      ingredients: [
        { item: "Basmati rice", g: [65, 70], as: "uncooked", section: s("Cupboard") },
        { item: "Egg whites, pasteurised", g: [175, 185], section: s("Dairy & eggs") },
        { item: "Eggs", g: [110, 115], as: "whole - about 2", section: s("Dairy & eggs") },
        { item: "Sweetcorn, tinned", g: [60, 65], section: s("Cupboard") },
      ],
    },
    {
      id: "tuna-avocado-toast",
      name: "Tuna and avocado toast with carrots",
      kcal: [503, 534],
      protein: [37, 40],
      carbs: [60, 64],
      fat: [12, 12],
      prepMin: 5,
      cookMin: 5,
      ingredients: [
        { item: "Whole grain rye bread", g: [130, 140], section: s("Bakery") },
        { item: TUNA, g: [120, 125], section: s("Cupboard") },
        { item: "Carrots", g: [125, 135], section: s("Fruit & veg") },
        { item: "Avocado", g: [45, 50], as: "flesh only", section: s("Fruit & veg") },
      ],
      method: [
        "Drain the tuna and rinse the carrots. Halve the avocado, remove the stone and slice the flesh.",
        "Toast the bread and top with the tuna and avocado. Season to taste.",
        "Eat the carrots on the side.",
      ],
    },
    {
      id: "tomato-mozzarella-crispbread",
      name: "Tomato and mozzarella on crispbread",
      kcal: [508, 540],
      protein: [34, 36],
      carbs: [63, 67],
      fat: [12, 13],
      prepMin: 5,
      ingredients: [
        { item: "Tomatoes", g: [115, 125], section: s("Fruit & veg") },
        { item: "Mozzarella light (8-9% fat)", g: [130, 135], section: s("Dairy & eggs") },
        { item: "Crispbread, Sport (Wasa)", g: [80, 85], section: s("Bakery") },
        { item: "Balsamic glaze", g: [15, 15], section: s("Cupboard") },
      ],
      method: ["Rinse and slice the tomato. Slice the mozzarella.", "Put them on the crispbread and top with balsamic glaze."],
    },
  ],
  snack: [
    {
      id: "shake-rice-cakes",
      name: "Protein shake, rice cakes and nut butter",
      kcal: [474, 504],
      protein: [35, 38],
      carbs: [57, 61],
      fat: [11, 11],
      prepMin: 5,
      ingredients: [
        { item: "Peanut butter (99% peanuts)", g: [20, 20], section: s("Cupboard") },
        { item: "Rice cakes", g: [65, 70], section: s("Cupboard") },
        { item: PROTEIN, g: [25, 30], section: s("Cupboard") },
      ],
      method: ["Mix the protein powder with the water the packet suggests (add more water or ice to taste).", "Eat the rice cakes with the peanut butter on the side."],
    },
    {
      id: "cold-oats-apple",
      name: "Cold oats with protein powder and apple (or blueberries)",
      kcal: [469, 499],
      protein: [35, 37],
      carbs: [55, 58],
      fat: [12, 12],
      prepMin: 5,
      ingredients: [
        { item: "Apples", g: [125, 135], as: "or 100 g blueberries", section: s("Fruit & veg") },
        { item: "Oats", g: [60, 60], section: s("Cupboard") },
        { item: PROTEIN, g: [30, 30], section: s("Cupboard") },
        { item: COCONUT_OIL, g: [5, 10], section: s("Cupboard") },
      ],
      method: ["Mix the protein powder and oats together.", "Add the apple (or rinsed blueberries - 100 g if so) and the oil."],
    },
    {
      id: "weetabix-snack",
      name: "Weetabix with protein",
      kcal: [469, 499],
      protein: [35, 38],
      carbs: [56, 60],
      fat: [10, 11],
      prepMin: 5,
      ingredients: [
        { item: ALMOND_BUTTER, g: [10, 10], section: s("Cupboard") },
        { item: WEETBIX, g: [75, 80], section: s("Cupboard") },
        { item: WHEY, g: [30, 35], as: "flavoured", section: s("Cupboard") },
      ],
    },
    {
      id: "protein-shake-malto",
      name: "Protein shake",
      kcal: [474, 504],
      protein: [36, 39],
      carbs: [57, 61],
      fat: [10, 11],
      prepMin: 10,
      ingredients: [
        { item: WHEY, g: [45, 45], as: "any flavour", section: s("Cupboard") },
        { item: "Maltodextrin powder", g: [55, 55], section: s("Cupboard") },
        { item: ALMOND_BUTTER, g: [15, 15], section: s("Cupboard") },
      ],
    },
  ],
  dinner: [
    {
      id: "creamy-tuna-pasta",
      name: "Creamy tuna pasta with sweetcorn",
      kcal: [455, 483],
      protein: [33, 36],
      carbs: [55, 58],
      fat: [11, 11],
      prepMin: 10,
      cookMin: 20,
      ingredients: [
        { item: TUNA, g: [85, 95], section: s("Cupboard") },
        { item: "Sweetcorn, tinned", g: [45, 45], section: s("Cupboard") },
        { item: "Semi-skimmed milk (1.5-1.8% fat)", g: [45, 45], section: s("Dairy & eggs") },
        { item: "Pasta", g: [55, 60], as: "uncooked", section: s("Cupboard") },
        { item: "Crème fraîche / sour cream (9% fat)", g: [75, 80], section: s("Dairy & eggs") },
        { item: "Cherry tomatoes", g: [45, 45], section: s("Fruit & veg") },
        { item: "Hot pepper sauce", amount: "1-2 tsp", section: s("Herbs, spices & extras") },
      ],
      method: [
        "Cook the pasta in lightly salted water as the packet says.",
        "Drain the tuna and sweetcorn. Rinse and halve the tomatoes.",
        "Bring the milk, crème fraîche and hot sauce to the boil over a low-medium heat, stirring until creamy. Add the tuna and corn and heat through. Season.",
        "Serve the pasta with the tuna sauce and tomatoes.",
      ],
    },
    {
      id: "steak-rice-pumpkin",
      name: "Steak, rice and pumpkin",
      kcal: [455, 483],
      protein: [33, 35],
      carbs: [55, 58],
      fat: [11, 12],
      prepMin: 5,
      cookMin: 20,
      ingredients: [
        { item: "Pumpkin", g: [170, 180], as: "raw", section: s("Fruit & veg") },
        { item: "Sirloin steak, lean", g: [85, 90], as: "cooked weight", section: s("Meat & fish") },
        { item: "Basmati rice", g: [60, 65], as: "uncooked", section: s("Cupboard") },
        { item: COCONUT_OIL, g: [5, 5], section: s("Cupboard") },
      ],
    },
    {
      id: "meat-sauce-pasta",
      name: "Simple meat sauce with pasta",
      kcal: [455, 483],
      protein: [33, 35],
      carbs: [52, 55],
      fat: [12, 13],
      prepMin: 5,
      cookMin: 10,
      ingredients: [
        { item: "Lean beef steak mince (3-7% fat)", g: [95, 100], as: "cooked weight", section: s("Meat & fish") },
        { item: "Pasta sauce / tomato sauce", g: [85, 90], section: s("Cupboard") },
        { item: "Pasta", g: [55, 60], as: "uncooked", section: s("Cupboard") },
        { item: "Brown onions", g: [50, 50], section: s("Fruit & veg") },
      ],
      method: [
        "Cook the pasta in lightly salted water as the packet says.",
        "Peel and grate the onion. Fry the mince in a non-stick pan over a medium heat until golden.",
        "Add the onion and pasta sauce and cook about 1 minute. Season.",
        "Serve the meat sauce with the pasta.",
      ],
    },
    {
      id: "chicken-tortilla-wrap",
      name: "Tortilla wrap with pan-fried chicken and tomato salsa",
      kcal: [459, 488],
      protein: [31, 33],
      carbs: [57, 61],
      fat: [11, 12],
      prepMin: 10,
      cookMin: 15,
      ingredients: [
        { item: "Mayonnaise, light", g: [15, 15], as: "26-28% fat", section: s("Cupboard") },
        { item: CHICKEN, g: [100, 105], as: "cooked, ready to eat", section: s("Meat & fish") },
        { item: "Tomatoes", g: [80, 85], section: s("Fruit & veg") },
        { item: "Wholemeal tortillas", g: [85, 90], section: s("Bakery") },
        { item: "Cucumber", g: [70, 75], section: s("Fruit & veg") },
        { item: "Lettuce", g: [20, 20], section: s("Fruit & veg") },
        { item: "Tomato salsa", g: [25, 30], section: s("Cupboard") },
      ],
      method: [
        "Rinse the lettuce, cucumber and tomatoes; slice the tomatoes and cucumber.",
        "Season the chicken, cut it smaller and fry with a splash of water over a medium-high heat for about 10 minutes until no longer pink.",
        "Warm the tortilla (packet instructions, or 4 minutes in the oven at 250°C).",
        "Fill with the tomato, cucumber, salsa, chicken and lettuce, wrap and serve warm.",
      ],
    },
  ],
};

const NAMES: Record<CategoryId, string> = { post: "Post-workout snack", breakfast: "Breakfast", lunch: "Lunch", snack: "Snack 1", dinner: "Dinner" };
const ORDER: CategoryId[] = ["post", "breakfast", "lunch", "snack", "dinner"];

/** The newer plan at one of its two sizes (0 = 2400 kcal, 1 = 2550 kcal). */
export function newPlanCategories(size: 0 | 1, prefix: string, targets: Record<CategoryId, number>): Category[] {
  return ORDER.map((id) => ({
    id,
    name: NAMES[id],
    kcal: targets[id],
    trainingOnly: id === "post",
    meals: MEALS[id].map(
      (m): Meal => ({
        id: `${prefix}:${m.id}`,
        name: m.name,
        kcal: m.kcal[size],
        protein: m.protein[size],
        carbs: m.carbs[size],
        fat: m.fat[size],
        prepMin: m.prepMin,
        cookMin: m.cookMin,
        method: m.method,
        ingredients: m.ingredients.map(({ g, ...rest }) => (g ? { ...rest, g: g[size] } : rest)),
      }),
    ),
  }));
}
