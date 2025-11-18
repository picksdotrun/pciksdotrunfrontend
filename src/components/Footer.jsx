const Footer = () => {
  return (
    <footer className="bg-card-bg border-t border-card-border px-4 py-6 mt-12">
      <div className="container mx-auto flex items-center justify-between text-sm text-gray-secondary">
        <span>($) PICKS</span>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            Follow us
          </a>
        </div>
      </div>
    </footer>
  )
}

export default Footer
