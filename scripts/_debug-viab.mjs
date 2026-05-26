import {
  assessLocalViability,
  decideSentenceState,
} from "../src/lib/domain/sentence-coach.ts";

const s =
  "if want to pursue academic path, students should learn their interested fields, learning and accumulating knowledge needs time";
const v = assessLocalViability(s);
console.log("issues:", JSON.stringify(v.issues, null, 2));
console.log("score:", v.score, "confidence:", v.confidence);
console.log(
  "decision:",
  decideSentenceState({
    meaningAligned: true,
    structuralWorkable: true,
    viability: v,
  }),
);
