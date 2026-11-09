import type { CategoryId, Meal } from "./mealPlan";

// Lizette's meal plan from Tristan: 1500 kcal a day - protein 110 g, carbs
// 183 g, fat 34 g - meals of about 300 kcal. Transcribed from photos of the
// printed plan; the prawns' kcal was hidden by glare, so it's worked out
// from their macros, and the haddock's partly hidden "...01" read as 301.

export const LIZETTE_DAILY = { kcal: 1500, protein: 110, carbs: 183, fat: 34 };

/**
 * Lizette's target for each category, kcal - her meals are about 300 each.
 * Her fifth meal is the post-workout snack (Malcolm confirmed), on training
 * days only - it makes up the rest of her 1500. No pages of her own for it
 * were photographed, so she picks from the shared library's post-workout meals.
 */
export const LIZETTE_TARGETS: Record<CategoryId, number> = { post: 290, breakfast: 290, lunch: 320, snack: 300, dinner: 300 };

const WHEY = "Whey protein powder";

export const LIZETTE_MEALS: Partial<Record<CategoryId, Meal[]>> = {
  breakfast: [
    {
      id: "liz:protein-oats-blueberries",
      name: "Protein oats with blueberries",
      kcal: 288,
      protein: 21,
      carbs: 35,
      fat: 7,
      prepMin: 5,
      cookMin: 5,
      ingredients: [
        { item: WHEY, g: 15, as: "flavoured", section: "Cupboard" },
        { item: "Oats", g: 55, section: "Cupboard" },
        { item: "Blueberries", g: 25, section: "Fruit & veg" },
        { item: "Almond butter (100% almonds)", g: 5, section: "Cupboard" },
      ],
      method: ["Mix the oats with water.", "Stir in the whey protein.", "Add the blueberries."],
    },
    {
      id: "liz:banana-pancakes",
      name: "Banana pancakes with almond butter",
      kcal: 292,
      protein: 21,
      carbs: 34,
      fat: 8,
      prepMin: 5,
      cookMin: 10,
      ingredients: [
        { item: "Bananas", g: 75, as: "peeled", section: "Fruit & veg" },
        { item: "Egg whites, pasteurised", g: 30, section: "Dairy & eggs" },
        { item: "Oats", g: 25, section: "Cupboard" },
        { item: WHEY, g: 15, as: "flavoured", section: "Cupboard" },
        { item: "Almond butter (100% almonds)", g: 10, section: "Cupboard" },
      ],
      method: [
        "Blend the egg white, protein powder, banana and oats.",
        "Heat a non-stick pan to medium. Pour 1-2 tbsp of batter per pancake and fry about 1.5 minutes until bubbles appear, then flip and cook until golden. Repeat with the rest.",
        "Serve with the almond butter.",
      ],
    },
    {
      id: "liz:protein-yoghurt",
      name: "Protein yoghurt",
      kcal: 292,
      protein: 22,
      carbs: 34,
      fat: 7,
      prepMin: 10,
      ingredients: [
        { item: "Apples", g: 145, section: "Fruit & veg" },
        { item: "Yoghurt, 0% fat (Campina mager)", g: 105, section: "Dairy & eggs" },
        { item: "Strawberries", g: 130, as: "frozen", section: "Frozen" },
        { item: WHEY, g: 20, as: "flavoured", section: "Cupboard" },
        { item: "Whole almonds", g: 10, as: "raw, with skin", section: "Cupboard" },
      ],
    },
  ],
  lunch: [
    {
      id: "liz:chicken-apple-salad",
      name: "Chicken and apple salad with mayonnaise dressing",
      kcal: 320,
      protein: 24,
      carbs: 38,
      fat: 8,
      prepMin: 10,
      cookMin: 20,
      ingredients: [
        { item: "Apples", g: 95, section: "Fruit & veg" },
        { item: "Iceberg lettuce", g: 120, section: "Fruit & veg" },
        { item: "Red onions", g: 70, section: "Fruit & veg" },
        { item: "Red bell peppers", g: 135, section: "Fruit & veg" },
        { item: "Mayonnaise, light", g: 15, as: "26-28% fat", section: "Cupboard" },
        { item: "Strawberry jam", g: 15, section: "Cupboard" },
        { item: "Chicken breast fillet, raw", g: 95, section: "Meat & fish" },
        { item: "Celery", g: 40, section: "Fruit & veg" },
        { item: "Lemons", amount: "1-2 slices + 1-2 tbsp juice", section: "Fruit & veg" },
      ],
      method: [
        "Boil the chicken in salted water for 20-25 minutes (a few lemon slices or herbs add flavour).",
        "Meanwhile rinse the pepper, celery, lettuce and apple; peel the onion; core the pepper and apple. Finely chop them all.",
        "Mix the mayonnaise, jam and lemon juice in a large bowl; season.",
        "Mix in the chopped vegetables and apple.",
        "Dice the chicken and mix it through before serving.",
      ],
    },
  ],
  snack: [
    {
      id: "liz:tomato-tuna-toast",
      name: "Toasted bread with grated tomato and tuna",
      kcal: 300,
      protein: 20,
      carbs: 37,
      fat: 7,
      prepMin: 5,
      ingredients: [
        { item: "Coconut oil", g: 5, section: "Cupboard" },
        { item: "Wholemeal bread", g: 85, as: "about 2 slices", section: "Bakery" },
        { item: "Tomatoes", g: 65, section: "Fruit & veg" },
        { item: "Tuna in water, tinned", g: 50, as: "about half a tin", section: "Cupboard" },
      ],
      method: [
        "Rinse and grate the tomato, season with salt and pepper, and drizzle with the oil.",
        "Toast the bread and drain the tuna.",
        "Top the bread with the grated tomato and tuna.",
      ],
    },
    {
      id: "liz:tomato-mozzarella-crispbread",
      name: "Tomato and mozzarella on crispbread",
      kcal: 300,
      protein: 20,
      carbs: 37,
      fat: 7,
      prepMin: 5,
      ingredients: [
        { item: "Tomatoes", g: 70, section: "Fruit & veg" },
        { item: "Mozzarella light (8-9% fat)", g: 75, section: "Dairy & eggs" },
        { item: "Crispbread, Sport (Wasa)", g: 45, as: "about 3", section: "Bakery" },
        { item: "Balsamic glaze", g: 10, section: "Cupboard" },
      ],
      method: ["Rinse and slice the tomato. Slice the mozzarella.", "Put them on the crispbread and top with balsamic glaze."],
    },
    {
      id: "liz:protein-milk-coco-pops",
      name: "Protein milk with Coco Pops",
      kcal: 297,
      protein: 22,
      carbs: 37,
      fat: 6,
      prepMin: 5,
      ingredients: [
        { item: "Whole milk, lactose free (3.5-4% fat)", g: 155, section: "Dairy & eggs" },
        { item: "Coco Pops (Kellogg's)", g: 40, section: "Cupboard" },
        { item: "Protein powder", g: 15, section: "Cupboard" },
      ],
      method: ["Blend the milk with the protein powder until smooth.", "Pour it over the Coco Pops. Any left over can be drunk on the side."],
    },
  ],
  dinner: [
    {
      id: "liz:chicken-broccoli-avocado-pasta",
      name: "Chicken, broccoli and avocado pasta",
      kcal: 301,
      protein: 22,
      carbs: 36,
      fat: 7,
      prepMin: 10,
      cookMin: 15,
      ingredients: [
        { item: "Chicken breast fillet pieces", g: 65, as: "cooked, ready to eat", section: "Meat & fish" },
        { item: "Broccoli", g: 90, section: "Fruit & veg" },
        { item: "Pasta, gluten free", g: 45, as: "uncooked", section: "Cupboard" },
        { item: "Avocado", g: 25, as: "flesh only", section: "Fruit & veg" },
      ],
      method: [
        "Cook the pasta in salted water as the packet says.",
        "Season the chicken and fry on a medium-high heat until no longer pink; slice.",
        "Cut the broccoli into florets and boil about 3 minutes until tender.",
        "Mix the chicken, broccoli and pasta.",
        "Dice the avocado and put it on top.",
      ],
    },
    {
      id: "liz:chicken-tortilla-wrap",
      name: "Tortilla wrap with pan-fried chicken and tomato salsa",
      kcal: 323,
      protein: 24,
      carbs: 37,
      fat: 8,
      prepMin: 10,
      cookMin: 15,
      ingredients: [
        { item: "Chicken breast fillet pieces", g: 80, as: "cooked, ready to eat", section: "Meat & fish" },
        { item: "Tomatoes", g: 55, section: "Fruit & veg" },
        { item: "Wholemeal tortillas", g: 55, as: "about 1", section: "Bakery" },
        { item: "Cucumber", g: 50, section: "Fruit & veg" },
        { item: "Lettuce", g: 15, section: "Fruit & veg" },
        { item: "Tomato salsa", g: 15, section: "Cupboard" },
        { item: "Whole almonds", g: 5, as: "raw, with skin", section: "Cupboard" },
      ],
      method: [
        "Rinse the lettuce, cucumber and tomatoes; slice the tomatoes and cucumber.",
        "Season the chicken, cut it smaller and fry with a splash of water over a medium-high heat for about 10 minutes.",
        "Warm the tortilla (packet instructions, or 4 minutes in the oven at 250°C).",
        "Fill with the tomato, cucumber, salsa, chicken and lettuce and wrap. Eat the almonds on the side.",
      ],
    },
    {
      id: "liz:air-fryer-prawns",
      name: "Air fryer breaded prawns with salad and spicy mayo dip",
      kcal: 320,
      protein: 24,
      carbs: 39,
      fat: 7,
      prepMin: 20,
      cookMin: 10,
      ingredients: [
        { item: "Wheat flour", g: 20, section: "Cupboard" },
        { item: "Prawns, raw, peeled", g: 75, as: "defrosted", section: "Frozen" },
        { item: "Breadcrumbs / panko", g: 25, section: "Cupboard" },
        { item: "Mayonnaise, light", g: 20, as: "26-28% fat", section: "Cupboard" },
        { item: "Lettuce", g: 25, section: "Fruit & veg" },
        { item: "Egg whites, pasteurised", g: 60, section: "Dairy & eggs" },
        { item: "Cherry tomatoes", g: 40, section: "Fruit & veg" },
        { item: "Chipotle peppers in adobo, tinned", amount: "1/2-1 tsp", section: "Herbs, spices & extras" },
        { item: "Limes", amount: "2-3 wedges", section: "Fruit & veg" },
      ],
      method: [
        "You need an air fryer. Preheat it to 200°C. Rinse and clean the prawns.",
        "Set out three bowls: egg whites whisked with salt and pepper, flour, breadcrumbs. Coat each prawn in flour, then egg, then breadcrumbs.",
        "Air fry in a single layer for 8-10 minutes (in batches if needed).",
        "Meanwhile slice the lettuce and halve the tomatoes for a salad. Chop the chipotle and mix it into the mayo for the dip.",
        "Serve the prawns with the salad and dip, with lime squeezed over.",
      ],
    },
    {
      id: "liz:lemon-haddock",
      name: "Baked lemon haddock with roasted potatoes and salad",
      kcal: 301,
      protein: 22,
      carbs: 37,
      fat: 7,
      prepMin: 15,
      cookMin: 40,
      ingredients: [
        { item: "Tomatoes", g: 80, section: "Fruit & veg" },
        { item: "Sweetcorn, tinned", g: 60, section: "Cupboard" },
        { item: "Potatoes", g: 150, as: "medium", section: "Fruit & veg" },
        { item: "Kale", g: 20, section: "Fruit & veg" },
        { item: "Haddock fillets, raw", g: 95, section: "Meat & fish" },
        { item: "Butter, salted", g: 5, section: "Dairy & eggs" },
        { item: "Lemons", amount: "2-4 slices, 1-2 pinches zest, 1-2 tbsp juice", section: "Fruit & veg" },
        { item: "Red chilli", amount: "1-2 pinches, chopped", section: "Herbs, spices & extras" },
        { item: "Garlic", amount: "1-2 cloves", section: "Fruit & veg" },
      ],
      method: [
        "Heat the oven to 200°C (180°C fan). Scrub and dice the potatoes, season, and roast on a lined tray for 30-40 minutes until soft.",
        "Strip and finely chop the kale; massage it with a little salt and lemon juice until it softens.",
        "Drain and rinse the sweetcorn. Dice the tomatoes and mix with the kale and corn.",
        "Season the haddock and put it on a small baking tray. Mix the butter, garlic, chilli, the rest of the lemon juice and the zest, pour over, and lay the lemon slices on and around it.",
        "Bake the haddock with the potatoes for the last 10-12 minutes, until it flakes easily. Serve everything together.",
      ],
    },
    {
      id: "liz:steak-mash",
      name: "Steak and mashed potatoes",
      kcal: 300,
      protein: 24,
      carbs: 35,
      fat: 7,
      prepMin: 15,
      cookMin: 40,
      ingredients: [
        { item: "Whole milk, lactose free (3.5-4% fat)", g: 95, section: "Dairy & eggs" },
        { item: "Potatoes", g: 190, as: "medium", section: "Fruit & veg" },
        { item: "Sirloin steak, lean", g: 55, as: "cooked weight", section: "Meat & fish" },
        { item: "Ground nutmeg", amount: "1-2 pinches", section: "Herbs, spices & extras" },
      ],
      method: [
        "Peel and chop the potatoes; boil in salted water until soft. Drain and mash with the warm milk, nutmeg, salt and pepper until smooth.",
        "Brown the steak with a splash of water on a high heat, then lower the heat and fry each side, keeping it pink in the middle. Rest 5 minutes.",
        "Serve the steak with the mash.",
      ],
    },
  ],
};
