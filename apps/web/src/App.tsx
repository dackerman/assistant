import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { ConversationSidebar } from '@/components/chat/ConversationSidebar'
import { ConversationView } from '@/components/chat/ConversationView'
import { Button } from '@/components/ui/button'

// Component for the conversation route
function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const conversationId = id ? Number.parseInt(id, 10) : undefined

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Handle responsive behavior
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 768)
    }

    checkIsDesktop()
    window.addEventListener('resize', checkIsDesktop)
    return () => window.removeEventListener('resize', checkIsDesktop)
  }, [])

  const handleConversationSelect = (conversationId: number) => {
    console.log('App: Conversation selected:', conversationId)
    navigate(`/conversation/${conversationId}`)
    // Close sidebar on mobile after selection
    if (!isDesktop) {
      setIsSidebarOpen(false)
    }
  }

  const handleNewConversation = () => {
    navigate('/')
    // Close sidebar on mobile after creating new conversation
    if (!isDesktop) {
      setIsSidebarOpen(false)
    }
  }

  const handleConversationCreate = (conversationId: number) => {
    navigate(`/conversation/${conversationId}`)
    // Trigger sidebar refresh to show the new conversation
    setRefreshTrigger(prev => prev + 1)
  }

  const handleConversationDelete = (deletedConversationId: number) => {
    // If we're currently viewing the deleted conversation, navigate to home
    if (conversationId === deletedConversationId) {
      navigate('/')
    }
    // Trigger sidebar refresh to remove the deleted conversation from the list
    setRefreshTrigger(prev => prev + 1)
  }

  const handleTitleUpdate = () => {
    // Trigger sidebar refresh to show the updated title
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile menu button */}
      <div className="absolute top-4 left-4 z-10 sm:hidden">
        <Button
          onClick={() => setIsSidebarOpen(true)}
          variant="outline"
          size="icon"
          className="h-9 w-9"
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      {/* Sidebar */}
      <div
        className={`${isSidebarOpen ? 'fixed inset-0 z-50' : 'hidden'} sm:relative sm:block sm:z-auto`}
      >
        {/* Mobile backdrop */}
        {isSidebarOpen && (
          <div
            className="absolute inset-0 bg-black/50 sm:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar content */}
        <div className="relative sm:h-full">
          <ConversationSidebar
            currentConversationId={conversationId}
            onConversationSelect={handleConversationSelect}
            onNewConversation={handleNewConversation}
            onClose={() => setIsSidebarOpen(false)}
            isOpen={isSidebarOpen || isDesktop}
            refreshTrigger={refreshTrigger}
            onConversationDelete={handleConversationDelete}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <ConversationView
          conversationId={conversationId}
          onConversationCreate={handleConversationCreate}
          onTitleUpdate={handleTitleUpdate}
        />
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<ConversationPage />} />
      <Route path="/conversation/:id" element={<ConversationPage />} />
    </Routes>
  )
}

export default App
