import contentTypes from './content-types/index.ts'

// Strapi's plugin loader registers the schemas exported in contentTypes.
export default {
  register() {},
  bootstrap() {},
  destroy() {},
  contentTypes,
}
