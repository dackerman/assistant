import { useEffect, useState, useRef } from "react";

interface SparkleParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  startX: number;
  startY: number;
}

interface SparkleExplosionProps {
  trigger: number;
  className?: string;
  children: React.ReactNode;
}

export function SparkleExplosion({
  trigger,
  className = "",
  children,
}: SparkleExplosionProps) {
  const [particles, setParticles] = useState<SparkleParticle[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (trigger === 0) return;

    // Get the element's position on the screen
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const titleWidth = rect.width;
    const centerY = rect.top + rect.height / 2;

    // Create 5 sparkle particles spread across the title width
    const newParticles: SparkleParticle[] = [];
    for (let i = 0; i < 5; i++) {
      // Distribute sparkles across the width of the title
      const widthProgress = i / 4; // 0, 0.25, 0.5, 0.75, 1
      const startX = rect.left + titleWidth * widthProgress;

      newParticles.push({
        id: i,
        x: 0,
        y: 0,
        vx: (Math.random() - 0.5) * 100, // Stronger horizontal velocity for wider spread
        vy: Math.random() * -40 - 20, // Stronger upward velocity
        life: 1,
        startX: startX,
        startY: centerY,
      });
    }
    setParticles(newParticles);

    // Animate particles for 800ms (slower fade)
    const animationDuration = 800;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / animationDuration;

      if (progress >= 1) {
        setParticles([]);
        return;
      }

      setParticles((prev) =>
        prev.map((particle) => ({
          ...particle,
          x: particle.vx * progress,
          y: particle.vy * progress + 0.5 * 150 * progress * progress, // stronger gravity
          life: Math.max(0, 1 - Math.pow(progress, 0.7)), // slower fade with easing
        })),
      );

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [trigger]);

  return (
    <>
      <div ref={containerRef} className={`relative ${className}`}>
        {children}
      </div>
      {/* Render sparkles at document level to avoid clipping */}
      {particles.map((particle) => (
        <div
          key={`${trigger}-${particle.id}`}
          className="pointer-events-none select-none"
          style={{
            position: "fixed",
            left: particle.startX + particle.x,
            top: particle.startY + particle.y,
            transform: "translate(-50%, -50%)",
            opacity: particle.life,
            fontSize: "18px",
            zIndex: 9999,
          }}
        >
          ✨
        </div>
      ))}
    </>
  );
}
