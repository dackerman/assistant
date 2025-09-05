import { useEffect, useState } from "react";

interface SparkleParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface SparkleExplosionProps {
  trigger: number;
  className?: string;
  children: React.ReactNode;
}

export function SparkleExplosion({ trigger, className = "", children }: SparkleExplosionProps) {
  const [particles, setParticles] = useState<SparkleParticle[]>([]);

  useEffect(() => {
    if (trigger === 0) return;

    // Create 5 sparkle particles with random trajectories
    const newParticles: SparkleParticle[] = [];
    for (let i = 0; i < 5; i++) {
      newParticles.push({
        id: i,
        x: 0,
        y: 0,
        vx: (Math.random() - 0.5) * 60, // Random horizontal velocity
        vy: Math.random() * -20 - 10, // Initial upward velocity
        life: 1,
      });
    }
    setParticles(newParticles);

    // Animate particles for 500ms
    const animationDuration = 500;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / animationDuration;

      if (progress >= 1) {
        setParticles([]);
        return;
      }

      setParticles(prev =>
        prev.map(particle => ({
          ...particle,
          x: particle.vx * progress,
          y: particle.vy * progress + 0.5 * 120 * progress * progress, // gravity
          life: 1 - progress, // fade out
        }))
      );

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [trigger]);

  return (
    <div className={`relative ${className}`}>
      {children}
      {particles.map(particle => (
        <div
          key={`${trigger}-${particle.id}`}
          className="absolute pointer-events-none select-none"
          style={{
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${particle.x}px), calc(-50% + ${particle.y}px))`,
            opacity: particle.life,
            fontSize: '14px',
            zIndex: 20,
          }}
        >
          ✨
        </div>
      ))}
    </div>
  );
}