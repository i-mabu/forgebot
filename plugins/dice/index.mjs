// dice プラグイン: 条件 diceAtLeast とアクション rollDice を提供する。
export default {
  conditions: {
    diceAtLeast: (ctx) => {
      const sides = Number(ctx.params.sides ?? 6);
      const threshold = Number(ctx.params.threshold ?? 4);
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) return false;
      if (!Number.isInteger(threshold)) return false;
      const roll = 1 + Math.floor(ctx.rng() * sides);
      return roll >= threshold;
    },
  },
  actions: {
    rollDice: (ctx) => {
      const sides = Number(ctx.params.sides ?? 6);
      if (!Number.isInteger(sides) || sides < 2 || sides > 1000) return null;
      const roll = 1 + Math.floor(ctx.rng() * sides);
      const template =
        typeof ctx.params.template === "string"
          ? ctx.params.template
          : "{user} rolled {roll}";
      return template
        .replaceAll("{roll}", String(roll))
        .replaceAll("{sides}", String(sides));
    },
  },
};
