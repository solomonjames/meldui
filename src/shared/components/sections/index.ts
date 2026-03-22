export { AcceptanceCriteriaSection } from "@/shared/components/sections/acceptance-criteria-section";
export { ChecklistSection } from "@/shared/components/sections/checklist-section";
export { CollapsibleSection } from "@/shared/components/sections/collapsible-section";
export { KeyValueSection } from "@/shared/components/sections/key-value-section";
export { MarkdownSection } from "@/shared/components/sections/markdown-section";
export {
  getSectionRenderer,
  registerSectionRenderer,
  type SectionProps,
} from "@/shared/components/sections/section-registry";

import { AcceptanceCriteriaSection } from "@/shared/components/sections/acceptance-criteria-section";
import { ChecklistSection } from "@/shared/components/sections/checklist-section";
import { KeyValueSection } from "@/shared/components/sections/key-value-section";
import { MarkdownSection } from "@/shared/components/sections/markdown-section";
// Register built-in renderers
import { registerSectionRenderer } from "@/shared/components/sections/section-registry";

registerSectionRenderer("markdown", MarkdownSection);
registerSectionRenderer("key_value", KeyValueSection);
registerSectionRenderer("acceptance_criteria", AcceptanceCriteriaSection);
registerSectionRenderer("checklist", ChecklistSection);
