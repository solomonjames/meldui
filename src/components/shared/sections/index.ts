// Shared barrel re-export for section renderers.
// Renderers live in @/components/backlog/sections/ — this barrel
// makes them importable from a location-neutral path.
export {
  CollapsibleSection,
  MarkdownSection,
  KeyValueSection,
  AcceptanceCriteriaSection,
  ChecklistSection,
  getSectionRenderer,
  registerSectionRenderer,
  type SectionProps,
} from "@/components/backlog/sections";
