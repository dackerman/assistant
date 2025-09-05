import { ConversationView } from "@/components/chat/ConversationView";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useState, useEffect } from "react";

function App() {
  const [currentConversationId, setCurrentConversationId] = useState<
    number | undefined
  >(undefined);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Handle responsive behavior
  useEffect(() => {
    const checkIsDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };

    checkIsDesktop();
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  const handleConversationSelect = (conversationId: number) => {
    setCurrentConversationId(conversationId);
    // Close sidebar on mobile after selection
    if (!isDesktop) {
      setIsSidebarOpen(false);
    }
  };

  const handleNewConversation = () => {
    setCurrentConversationId(undefined);
    // Close sidebar on mobile after creating new conversation
    if (!isDesktop) {
      setIsSidebarOpen(false);
    }
  };

  const handleConversationCreate = (conversationId: number) => {
    setCurrentConversationId(conversationId);
    // Trigger sidebar refresh to show the new conversation
    setRefreshTrigger((prev) => prev + 1);
  };

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
        className={`${isSidebarOpen ? "fixed inset-0 z-50" : "hidden"} sm:relative sm:block sm:z-auto`}
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
            currentConversationId={currentConversationId}
            onConversationSelect={handleConversationSelect}
            onNewConversation={handleNewConversation}
            onClose={() => setIsSidebarOpen(false)}
            isOpen={isSidebarOpen || isDesktop}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <ConversationView
          conversationId={currentConversationId}
          onConversationCreate={handleConversationCreate}
        />
      </div>
    </div>
  );
}

export default App;
