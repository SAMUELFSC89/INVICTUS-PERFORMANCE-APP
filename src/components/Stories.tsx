import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Camera } from 'lucide-react';
import { storyService } from '../services/storyService';
import { auth } from '../firebase';
import { Story, UserProfile } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn, compressImage } from '../lib/utils';

interface StoriesProps {
  userProfile: UserProfile | null;
  followingIds: string[];
}

export function Stories({ userProfile, followingIds }: StoriesProps) {
  const [stories, setStories] = useState<Story[]>([]);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (auth.currentUser) {
      const unsub = storyService.listenToStories(followingIds, (updatedStories) => {
        setStories(updatedStories);
      });
      return () => unsub();
    }
  }, [followingIds]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleUploadStory = async () => {
    if (!selectedImage || !userProfile || !auth.currentUser) return;
    
    setIsUploading(true);
    try {
      const compressed = await compressImage(selectedImage);
      const result = await storyService.createStory(
        auth.currentUser.uid,
        compressed,
        userProfile.displayName,
        userProfile.photoURL
      );
      
      if (result) {
        setIsCreating(false);
        setSelectedImage(null);
        setPreviewUrl(null);
      }
    } catch (error) {
      console.error('Error uploading story:', error);
      alert('Erro ao postar story. Tente novamente.');
    } finally {
      setIsUploading(false);
    }
  };

  // Group stories by user
  const userStories = stories.reduce((acc, story) => {
    if (!acc[story.userId]) {
      acc[story.userId] = [];
    }
    acc[story.userId].push(story);
    return acc;
  }, {} as Record<string, Story[]>);

  const sortedUserIds = Object.keys(userStories).sort((a, b) => {
    if (a === auth.currentUser?.uid) return -1;
    if (b === auth.currentUser?.uid) return 1;
    return 0;
  });

  return (
    <div className="overflow-x-auto no-scrollbar py-4 border-b border-white/5 bg-background/50">
      <div className="flex gap-4 px-4 min-w-max">
        {/* Add Story Button */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative">
            <div 
              className="w-16 h-16 rounded-full p-0.5 border-2 border-white/10 cursor-pointer overflow-hidden"
              onClick={() => setIsCreating(true)}
            >
              <img 
                src={userProfile?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${auth.currentUser?.uid}`} 
                className="w-full h-full rounded-full object-cover" 
                alt="Me"
                referrerPolicy="no-referrer"
              />
            </div>
            <button 
              onClick={() => setIsCreating(true)}
              className="absolute bottom-0 right-0 w-5 h-5 bg-primary rounded-full border-2 border-background flex items-center justify-center text-white"
            >
              <Plus size={12} strokeWidth={4} />
            </button>
          </div>
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter">Seu Story</span>
        </div>

        {/* User Stories */}
        {sortedUserIds.filter(id => id !== auth.currentUser?.uid).map((userId) => {
          const userStoriesList = userStories[userId];
          const firstStory = userStoriesList[0];
          const allViewed = userStoriesList.every(s => s.viewedBy.includes(auth.currentUser?.uid || ''));

          return (
            <div 
              key={userId} 
              className="flex flex-col items-center gap-1.5 cursor-pointer"
              onClick={() => setActiveStoryIndex(stories.indexOf(firstStory))}
            >
              <div className={cn(
                "w-16 h-16 rounded-full p-0.5 border-2",
                allViewed ? "border-white/10" : "border-primary"
              )}>
                <div className="w-full h-full rounded-full border-2 border-background overflow-hidden">
                  <img 
                    src={firstStory.userPhotoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`} 
                    className="w-full h-full object-cover" 
                    alt={firstStory.userDisplayName}
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
              <span className="text-[10px] font-bold text-white uppercase tracking-tighter truncate w-16 text-center">
                {firstStory.userDisplayName.split(' ')[0]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Story Viewer Modal */}
      <AnimatePresence>
        {activeStoryIndex !== null && (
          <StoryViewer 
            stories={stories} 
            initialIndex={activeStoryIndex} 
            onClose={() => setActiveStoryIndex(null)} 
          />
        )}
      </AnimatePresence>

      {/* Create Story Modal */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-[110] bg-black flex flex-col">
            <div className="p-4 flex justify-between items-center z-10">
              <button onClick={() => setIsCreating(false)} className="text-white"><X size={24} /></button>
              <h2 className="text-white font-headline italic font-black text-xl uppercase">NOVO STORY</h2>
              <div className="w-6" />
            </div>

            <div className="flex-1 relative flex items-center justify-center bg-surface-container">
              {previewUrl ? (
                <img src={previewUrl} className="max-w-full max-h-full object-contain" alt="Preview" />
              ) : (
                <label className="flex flex-col items-center gap-4 text-on-surface-variant cursor-pointer">
                  <Camera size={64} />
                  <span className="font-bold uppercase tracking-widest text-xs">Capturar ou Selecionar</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                </label>
              )}
            </div>

            {previewUrl && (
              <div className="p-6 bg-background/80 backdrop-blur-md">
                <button 
                  onClick={handleUploadStory}
                  disabled={isUploading}
                  className="w-full py-4 bg-primary text-white font-headline italic font-black text-lg rounded-xl shadow-xl shadow-primary/20 uppercase tracking-widest disabled:opacity-50"
                >
                  {isUploading ? 'POSTANDO...' : 'COMPARTILHAR NO STORY'}
                </button>
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StoryViewer({ stories, initialIndex, onClose }: { stories: Story[], initialIndex: number, onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);
  const story = stories[index];

  useEffect(() => {
    if (story && auth.currentUser) {
      storyService.markAsViewed(story.id, auth.currentUser.uid);
    }

    const timer = setTimeout(() => {
      if (index < stories.length - 1) {
        setIndex(index + 1);
      } else {
        onClose();
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [index, stories, onClose]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (index > 0) setIndex(index - 1);
    else onClose();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (index < stories.length - 1) setIndex(index + 1);
    else onClose();
  };

  if (!story) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      className="fixed inset-0 z-[120] bg-black flex flex-col"
      onClick={onClose}
    >
      {/* Progress Bars */}
      <div className="absolute top-4 left-4 right-4 flex gap-1 z-20">
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: i < index ? "100%" : "0%" }}
              animate={{ width: i === index ? "100%" : (i < index ? "100%" : "0%") }}
              transition={{ duration: i === index ? 5 : 0, ease: "linear" }}
              className="h-full bg-white"
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-8 left-4 right-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <img 
            src={story.userPhotoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${story.userId}`} 
            className="w-8 h-8 rounded-full border border-white/20" 
            alt={story.userDisplayName}
            referrerPolicy="no-referrer"
          />
          <div>
            <p className="text-white font-bold text-sm">{story.userDisplayName}</p>
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">
              {formatDistanceToNow(new Date(story.createdAt), { addSuffix: true, locale: ptBR })}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white"><X size={24} /></button>
      </div>

      {/* Image */}
      <div className="flex-1 flex items-center justify-center">
        <img src={story.imageUrl} className="max-w-full max-h-full object-contain" alt="Story" referrerPolicy="no-referrer" />
      </div>

      {/* Navigation Areas */}
      <div className="absolute inset-0 flex z-10">
        <div className="w-1/3 h-full cursor-pointer" onClick={handlePrev} />
        <div className="w-2/3 h-full cursor-pointer" onClick={handleNext} />
      </div>
    </motion.div>
  );
}
