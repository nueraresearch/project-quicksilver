/**
 * Merge this entry into a Strapi host's config/plugins.ts. Resolve is relative
 * to that host project; adjust it if the Quicksilver directory is elsewhere.
 */
export default () => ({
  quicksilver: {
    enabled: true,
    resolve: '../quicksilver',
  },
})
