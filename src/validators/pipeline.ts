import type { ValidationViolation } from "../types.js";
import { validateAcceptanceCriteriaWriteGate } from "./acceptanceCriteriaWriteGate.js";
import { validateApprovalGate } from "./approval.js";
import { validateCompactionThresholds } from "./compactionThresholds.js";
import { validateDirectoryTaxonomy } from "./directoryTaxonomy.js";
import { validateFrontMatter } from "./frontMatter.js";
import { validateLastValidatedBump } from "./lastValidatedBump.js";
import { validateNonDestructive } from "./nonDestructive.js";
import { validatePolicyWeakeningDeclaration } from "./policyWeakening.js";
import { validatePrFormat } from "./prFormat.js";
import {
  validatePolicyWeakeningActiveWarn,
  validateRoadmapAcceptanceShape,
} from "./roadmapAcceptanceShape.js";
import { validateMilestoneGoalRefs } from "./milestoneGoalRefs.js";
import { validateRelationsShape } from "./relations.js";
import { validateRoadmapGoalIdsForMilestones } from "./roadmapGoalIdsForMilestones.js";
import { validateSectionShape } from "./sectionShape.js";
import { validateTrackedLinkLeak } from "./trackedLinkLeak.js";
import type { ValidationContext, Validator } from "./types.js";

const VALIDATORS: Validator[] = [
  validateFrontMatter,
  validatePolicyWeakeningDeclaration,
  validateSectionShape,
  validatePrFormat,
  validateTrackedLinkLeak,
  validateLastValidatedBump,
  validateApprovalGate,
  validateAcceptanceCriteriaWriteGate,
  validateRoadmapAcceptanceShape,
  validateRelationsShape,
  validateRoadmapGoalIdsForMilestones,
  validateMilestoneGoalRefs,
  validateNonDestructive,
  validateCompactionThresholds,
  validatePolicyWeakeningActiveWarn,
];

export async function runValidators(context: ValidationContext): Promise<ValidationViolation[]> {
  const taxonomyResults = await validateDirectoryTaxonomy(context);
  if (taxonomyResults.some((result) => result.code === "generated_file_reserved")) {
    return taxonomyResults;
  }

  const results = await Promise.all(VALIDATORS.map((validator) => validator(context)));
  return [...taxonomyResults, ...results.flat()];
}
