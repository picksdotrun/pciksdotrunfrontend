import { useState } from 'react'

const SearchBar = () => {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="relative mb-3 max-w-md mx-auto">
      <div className="relative">
        <svg 
          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-secondary"
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
          />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search players & teams"
          className="w-full bg-surface-muted border border-card-border rounded-lg pl-9 pr-3 py-2 text-sm text-gray-100 placeholder-gray-secondary focus:outline-none focus:border-purple-brand transition-colors"
        />
      </div>
    </div>
  )
}

export default SearchBar
