import { useEffect, useState } from "react";
import { SparkleExplosion } from "./SparkleExplosion";

interface ConversationTitleProps {
  title: string;
  className?: string;
  onTitleChange?: (title: string) => void;
  /** Force animation trigger - increment this value to trigger sparkles */
  animationTrigger?: number;
  /** Whether this title change should trigger sparkles - use for WebSocket updates only */
  shouldAnimate?: boolean;
}

export function ConversationTitle({
  title,
  className = "",
  onTitleChange,
  animationTrigger = 0,
  shouldAnimate = false,
}: ConversationTitleProps) {
  const [previousTitle, setPreviousTitle] = useState(title);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Only animate when explicitly told to via shouldAnimate prop
    if (
      shouldAnimate &&
      previousTitle === "New Conversation" &&
      title !== "New Conversation"
    ) {
      setIsAnimating(true);
      setSparkleKey((prev) => prev + 1);
      onTitleChange?.(title);

      // Reset animation state after completion
      setTimeout(() => setIsAnimating(false), 2000);
    }

    setPreviousTitle(title);
  }, [title, previousTitle, onTitleChange, shouldAnimate]);

  // Also respond to external animation triggers (for sidebar refreshes)
  useEffect(() => {
    if (animationTrigger > 0) {
      setIsAnimating(true);
      setSparkleKey((prev) => prev + 1);
      setTimeout(() => setIsAnimating(false), 2000);
    }
  }, [animationTrigger]);

  return (
    <SparkleExplosion
      trigger={sparkleKey}
      className={`${isAnimating ? "title-sparkle-effect active" : ""}`}
    >
      <div
        className={`${className} ${
          isAnimating ? "animate-sparkle-appear" : ""
        }`}
      >
        {title}
      </div>
    </SparkleExplosion>
  );
}
