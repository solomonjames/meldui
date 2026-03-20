export { CollapsibleSection } from "@/shared/components/sections/collapsible-section";
export { MarkdownSection } from "@/shared/components/sections/markdown-section";
export { KeyValueSection } from "@/shared/components/sections/key-value-section";
export { AcceptanceCriteriaSection } from "@/shared/components/sections/acceptance-criteria-section";
export { ChecklistSection } from "@/shared/components/sections/checklist-section";
export {
  getSectionRenderer,
  registerSectionRenderer,
  type SectionProps,
} from "@/shared/components/sections/section-registry";

// Register built-in renderers
import { registerSectionRenderer } from "@/shared/components/sections/section-registry";
import { MarkdownSection } from "@/shared/components/sections/markdown-section";
import { KeyValueSection } from "@/shared/components/sections/key-value-section";
import { AcceptanceCriteriaSection } from "@/shared/components/sections/acceptance-criteria-section";
import { ChecklistSection } from "@/shared/components/sections/checklist-section";

registerSectionRenderer("markdown", MarkdownSection);
registerSectionRenderer("key_value", KeyValueSection);
registerSectionRenderer("acceptance_criteria", AcceptanceCriteriaSection);
registerSectionRenderer("checklist", ChecklistSection);
