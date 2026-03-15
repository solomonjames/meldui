import "@testing-library/jest-dom/vitest";

// Polyfill scrollIntoView for jsdom
Element.prototype.scrollIntoView = () => {};
