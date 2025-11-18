const CategoryTabs = ({ activeCategory, setActiveCategory }) => {
  const categories = [
    { name: 'Popular', hot: true },
    { name: 'Points' },
    { name: 'Rebounds' },
    { name: 'Pts+Rebs+Asts' },
    { name: 'Fantasy' }
  ]

  return (
    <div className="flex gap-2 overflow-x-auto py-4 scrollbar-hide">
      {categories.map((category) => (
        <button
          key={category.name}
          onClick={() => setActiveCategory(category.name)}
          className={`px-4 py-2 rounded-full whitespace-nowrap transition-all ${
            activeCategory === category.name
              ? 'bg-green-bright text-dark-bg font-medium shadow-lg shadow-green-bright/30'
              : 'bg-surface-muted text-gray-secondary border border-card-border hover:border-green-bright'
          }`}
        >
          <span className="flex items-center gap-1">
            {category.hot && <div className="w-4 h-4 bg-orange-500 rounded-full"></div>}
            {category.name}
          </span>
        </button>
      ))}
    </div>
  )
}

export default CategoryTabs
