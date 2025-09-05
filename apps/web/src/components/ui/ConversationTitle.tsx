import { useEffect, useState } from "react";
import { SparkleExplosion } from "./SparkleExplosion";

interface ConversationTitleProps {
  title: string;
  className?: string;
  onTitleChange?: (title: string) => void;
  /** Force animation trigger - increment this value to trigger sparkles */
  animationTrigger?: number;
}

export function ConversationTitle({ 
  title, 
  className = "", 
  onTitleChange,
  animationTrigger = 0 
}: ConversationTitleProps) {
  const [previousTitle, setPreviousTitle] = useState(title);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Mark as initialized after first render to prevent initial animation
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    // Only animate after initialization and when title actually changes from WebSocket updates
    if (!isInitialized) {
      setPreviousTitle(title);
      return;
    }

    // Only animate if title changed from "New Conversation" to a real title
    // This specifically targets WebSocket title generation events
    const shouldAnimate = previousTitle === "New Conversation" && title !== "New Conversation";

    if (shouldAnimate) {
      setIsAnimating(true);
      setSparkleKey(prev => prev + 1);
      onTitleChange?.(title);
      
      // Reset animation state after completion (increased to match longer sparkle duration)
      setTimeout(() => setIsAnimating(false), 2000);
    }
    
    setPreviousTitle(title);
  }, [title, previousTitle, onTitleChange, isInitialized]);

  // Also respond to external animation triggers (for sidebar refreshes)
  useEffect(() => {
    if (animationTrigger > 0) {
      setIsAnimating(true);
      setSparkleKey(prev => prev + 1);
      setTimeout(() => setIsAnimating(false), 2000);
    }
  }, [animationTrigger]);

  return (
    <SparkleExplosion 
      trigger={sparkleKey}
      className={`${isAnimating ? 'title-sparkle-effect active' : ''}`}
    >
      <div 
        className={`${className} ${
          isAnimating ? 'animate-sparkle-appear' : ''
        }`}
      >
        {title}
      </div>
    </SparkleExplosion>
  );
}