// Ambient declarations for stylesheet imports.
//
// TypeScript 7 no longer accepts a bare side-effect import of a stylesheet
// without a module declaration (TS2882). Next.js handled this implicitly in
// earlier TypeScript versions, so `import './globals.css'` in app/layout.tsx
// used to type-check without a declaration file.
//
// These declarations restore that behaviour. They describe the shape only; no
// CSS is compiled or type-checked here.

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}