import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { WebsimSocket, useQuery } from '@websim/use-query';

const COLLECTION_NAME = 'comment_art_v2'; // V2 for potential schema/prompt changes

const room = new WebsimSocket({
  schema: {
    [COLLECTION_NAME]: {
      id: "uuid",
      user_id: "uuid",
      original_comment_text: "text",
      image_prompt: "text",
      generated_image_url: "text",
      // created_at and username are automatic
    },
  },
});

function ImageZoomer({ images }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(0);
  const [isZooming, setIsZooming] = useState(false);
  const imageContainerRef = useRef(null);
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [nextImageUrl, setNextImageUrl] = useState(null);

  useEffect(() => {
    if (!images || images.length === 0) return;

    const initialCurrent = Math.floor(Math.random() * images.length);
    let initialNext = initialCurrent;
    if (images.length > 1) {
      do {
        initialNext = Math.floor(Math.random() * images.length);
      } while (initialNext === initialCurrent);
    }
    
    setCurrentIndex(initialCurrent);
    setNextIndex(initialNext);
    setCurrentImageUrl(images[initialCurrent]?.generated_image_url);
    setNextImageUrl(images[initialNext]?.generated_image_url);

  }, [images]);

  useEffect(() => {
    if (!images || images.length === 0 || isZooming || !currentImageUrl) return;

    const zoomCycle = () => {
      setIsZooming(true);
      if (imageContainerRef.current) {
        imageContainerRef.current.style.transition = 'transform 3s cubic-bezier(0.4, 0, 0.2, 1)';
        imageContainerRef.current.style.transform = 'scale(2) translate(-25%, -25%)';
      }

      const transitionEndTimer = setTimeout(() => {
        const newCurrentIdx = nextIndex;
        let newNextIdx = newCurrentIdx;
        if (images.length > 1) {
          do {
            newNextIdx = Math.floor(Math.random() * images.length);
          } while (newNextIdx === newCurrentIdx);
        }

        // Update image URLs for the new state
        setCurrentImageUrl(images[newCurrentIdx]?.generated_image_url);
        setNextImageUrl(images[newNextIdx]?.generated_image_url);
        
        setCurrentIndex(newCurrentIdx);
        setNextIndex(newNextIdx);
        
        if (imageContainerRef.current) {
          imageContainerRef.current.style.transition = 'none';
          imageContainerRef.current.style.transform = 'scale(1) translate(0,0)';
        }
        
        // Use rAF to ensure DOM update before making next image visible
        requestAnimationFrame(() => {
            setIsZooming(false);
        });

      }, 3000); // Match transition duration

      return () => clearTimeout(transitionEndTimer);
    };

    const cycleTimer = setTimeout(zoomCycle, 4000); // Time visible before zoom starts
    return () => clearTimeout(cycleTimer);

  }, [images, currentIndex, nextIndex, isZooming, currentImageUrl]);

  if (!images || images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-xl text-gray-400">
        <p>No art has been generated yet.</p>
        <p>Enter a comment below to start!</p>
      </div>
    );
  }
  
  if (!currentImageUrl) {
    return (
        <div className="flex items-center justify-center h-screen text-xl text-gray-400">Loading images...</div>
    );
  }

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden bg-black">
      <div ref={imageContainerRef} className="w-full h-full">
        <img
          key={`current-${currentIndex}-${currentImageUrl}`}
          src={currentImageUrl}
          alt="Current art piece"
          className="w-full h-full object-cover"
          onError={(e) => e.target.style.display='none'} // Hide if image fails to load
        />
        {nextImageUrl && (
          <img
            key={`next-${nextIndex}-${nextImageUrl}`}
            src={nextImageUrl}
            alt="Next art piece, in center"
            className="absolute top-[25%] left-[25%] w-[50%] h-[50%] object-contain border-2 border-white/50 shadow-2xl"
            style={{ display: isZooming ? 'none' : 'block' }}
            onError={(e) => e.target.style.display='none'} // Hide if image fails to load
          />
        )}
      </div>
    </div>
  );
}

function App() {
  const [commentText, setCommentText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const { data: commentImages, loading: imagesLoading } = useQuery(
    room.collection(COLLECTION_NAME).orderBy('created_at', 'desc') // Get newest first, though randomizer ignores order
  );

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) {
      setError("Comment cannot be empty.");
      return;
    }
    setIsGenerating(true);
    setError('');
    setMessage('');

    try {
      const currentUser = await window.websim.getCurrentUser();
      if (!currentUser) {
        setError("Could not get user information. Are you logged in?");
        setIsGenerating(false);
        return;
      }

      // Prevent duplicate entries for the same comment by the same user
      const existingEntries = await room.collection(COLLECTION_NAME).filter({ 
        user_id: currentUser.id, 
        original_comment_text: commentText.trim() 
      }).getList();

      if (existingEntries && existingEntries.length > 0) {
        setMessage("You've already created art with this exact comment.");
        setIsGenerating(false);
        setCommentText('');
        return;
      }

      const imagePrompt = `White Blank Box in Center. ${commentText.trim()}. White Blank Box in Center.`;
      
      setMessage("Generating your masterpiece... this can take a moment.");
      const imageResult = await websim.imageGen({
        prompt: imagePrompt,
        aspect_ratio: "1:1", // Ensures square images, helping the "50% box" be square.
      });

      if (!imageResult || !imageResult.url) {
        throw new Error("Image generation failed to return a URL.");
      }

      await room.collection(COLLECTION_NAME).create({
        user_id: currentUser.id, // user_id will be automatically set, but good to be explicit if needed by schema. Here it's mostly for the duplicate check.
        original_comment_text: commentText.trim(),
        image_prompt: imagePrompt,
        generated_image_url: imageResult.url,
      });

      setMessage("Art created successfully! It will appear in the zoom cycle.");
      setCommentText('');
    } catch (err) {
      console.error("Error generating or saving art:", err);
      setError(`Failed to create art: ${err.message}`);
    } finally {
      setIsGenerating(false);
      // Message will clear on next action or after a timeout
      setTimeout(() => { setMessage(''); setError(''); }, 5000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center">
      <header className="w-full p-4 bg-gray-800 shadow-md fixed top-0 left-0 z-50">
        <h1 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">Recursive Comment Art</h1>
        <form onSubmit={handleCommentSubmit} className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter your art prompt idea"
            className="p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-transparent flex-grow sm:max-w-md"
            disabled={isGenerating}
          />
          <button
            type="submit"
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-md text-white font-semibold transition-colors duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Create Art'}
          </button>
        </form>
        {message && <p className="text-center mt-2 text-green-400">{message}</p>}
        {error && <p className="text-center mt-2 text-red-400">{error}</p>}
      </header>
      
      <main className="w-full h-screen pt-[150px] sm:pt-[120px]"> {/* Adjust padding top to clear fixed header */}
        {imagesLoading ? (
          <div className="flex items-center justify-center h-full text-xl">Loading art gallery...</div>
        ) : (
          <ImageZoomer images={commentImages || []} />
        )}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);

