const slugify = (label) =>
  (label || '')
    .toString()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export const HOME_CATEGORY_FILTERS = [
  { label: 'Trending', slug: 'trending', kind: 'trending' },
  { label: 'New', slug: 'new', kind: 'new' },
  { label: 'All', slug: 'all', kind: 'all' },
  { label: 'Politics', slug: 'politics', kind: 'category', match: 'Politics' },
  { label: 'Sports', slug: 'sports', kind: 'category', match: 'Sports' },
  { label: 'Culture', slug: 'culture', kind: 'category', match: 'Culture' },
  { label: 'Crypto', slug: 'crypto', kind: 'category', match: 'Crypto' },
  { label: 'Climate', slug: 'climate', kind: 'category', match: 'Climate' },
  { label: 'Economics', slug: 'economics', kind: 'category', match: 'Economics' },
  { label: 'Mentions', slug: 'mentions', kind: 'category', match: 'Mentions' },
  { label: 'Companies', slug: 'companies', kind: 'category', match: 'Companies' },
  { label: 'Financials', slug: 'financials', kind: 'category', match: 'Financials' },
  { label: 'Tech & Science', slug: 'tech-science', kind: 'category', match: 'Tech & Science' },
  { label: 'Health', slug: 'health', kind: 'category', match: 'Health' },
  { label: 'World', slug: 'world', kind: 'category', match: 'World' },
]

export const HOME_CATEGORY_LOOKUP = HOME_CATEGORY_FILTERS.reduce((acc, filter) => {
  acc[filter.slug] = filter
  return acc
}, {})

export const DEFAULT_CATEGORY_SLUG = 'all'

export const resolveCategorySlug = (rawValue) => {
  if (!rawValue) return DEFAULT_CATEGORY_SLUG
  const normalized = slugify(rawValue)
  if (HOME_CATEGORY_LOOKUP[normalized]) return normalized
  // allow labels as query param without slug formatting
  const labelMatch = HOME_CATEGORY_FILTERS.find((filter) => slugify(filter.label) === slugify(rawValue))
  return labelMatch ? labelMatch.slug : DEFAULT_CATEGORY_SLUG
}
