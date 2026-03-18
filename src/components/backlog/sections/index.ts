export { CollapsibleSection } from "./collapsible-section";
export { MarkdownSection } from "./markdown-section";
export { KeyValueSection } from "./key-value-section";
export { AcceptanceCriteriaSection } from "./acceptance-criteria-section";
export { ChecklistSection } from "./checklist-section";
export {
  getSectionRenderer,
  registerSectionRenderer,
  type SectionProps,
} from "./section-registry";

// Register built-in renderers
import { registerSectionRenderer } from "./section-registry";
import { MarkdownSection } from "./markdown-section";
import { KeyValueSection } from "./key-value-section";
import { AcceptanceCriteriaSection } from "./acceptance-criteria-section";
import { ChecklistSection } from "./checklist-section";

registerSectionRenderer("markdown", MarkdownSection);
registerSectionRenderer("key_value", KeyValueSection);
registerSectionRenderer("acceptance_criteria", AcceptanceCriteriaSection);
registerSectionRenderer("checklist", ChecklistSection);
