import type { ComponentType } from "react";
import type { SectionType, TicketSection } from "@/shared/types";

export interface SectionProps {
  section: TicketSection;
  onChange: (content: unknown) => void;
}

// Registry is populated by importing renderers
const registry: Partial<Record<SectionType, ComponentType<SectionProps>>> = {};

export function registerSectionRenderer(type: SectionType, component: ComponentType<SectionProps>) {
  registry[type] = component;
}

export function getSectionRenderer(type: SectionType): ComponentType<SectionProps> | undefined {
  return registry[type];
}
