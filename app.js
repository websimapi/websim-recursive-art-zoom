import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { WebsimSocket, useQuery } from '@websim/use-query';

const COLLECTION_NAME = 'comment_art_v2';

const room = new WebsimSocket({
  schema: {
    [COLLECTION_NAME]: {
      id: "uuid",
      user_id: "uuid", 
      original_comment_text: "text",
      image_prompt: "text",
      generated_image_url: "text",
    },
  },
});

function extractTextFromDocumentNode(docNode) {
  if (!docNode || !docNode.children) return '';
  let text = '';
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.type === 'text' && node.text) {
        text += node.text + ' ';
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }
  traverse(docNode.children);
  return text.trim();
}

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
    if (images[initialCurrent]) setCurrentImageUrl(images[initialCurrent].generated_image_url);
    if (images[initialNext]) setNextImageUrl(images[initialNext].generated_image_url);

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
          } while (newNextIdx === newCurrentIdx && images.length > 1); 
        }

        setCurrentImageUrl(images[newCurrentIdx]?.generated_image_url);
        setNextImageUrl(images[newNextIdx]?.generated_image_url);
        
        setCurrentIndex(newCurrentIdx);
        setNextIndex(newNextIdx);
        
        if (imageContainerRef.current) {
          imageContainerRef.current.style.transition = 'none';
          imageContainerRef.current.style.transform = 'scale(1) translate(0,0)';
        }
        
        requestAnimationFrame(() => {
            setIsZooming(false);
        });

      }, 3000); 

      return () => clearTimeout(transitionEndTimer);
    };

    const cycleTimer = setTimeout(zoomCycle, 4000); 
    return () => clearTimeout(cycleTimer);

  }, [images, currentIndex, nextIndex, isZooming, currentImageUrl]);

  if (!images || images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-xl text-gray-400">
        <p>No art has been generated yet from project comments.</p>
        <p>Or, project comments are still being processed.</p>
      </div>
    );
  }
  
  if (!currentImageUrl) {
    return (
        <div className="flex items-center justify-center h-full text-xl text-gray-400">Loading images...</div>
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
          onError={(e) => {
            console.warn(`Failed to load current image: ${currentImageUrl}`);
            e.target.style.display='none';
          }}
        />
        {nextImageUrl && (
          <img
            key={`next-${nextIndex}-${nextImageUrl}`}
            src={nextImageUrl}
            alt="Next art piece, in center"
            className="absolute top-[25%] left-[25%] w-[50%] h-[50%] object-contain border-2 border-white/50 shadow-2xl"
            style={{ display: isZooming ? 'none' : 'block' }}
            onError={(e) => {
                console.warn(`Failed to load next image: ${nextImageUrl}`);
                e.target.style.display='none';
            }}
          />
        )}
      </div>
    </div>
  );
}

function App() {
  const [processingStatus, setProcessingStatus] = useState('Initializing...');

  const { data: commentImages, loading: imagesLoading } = useQuery(
    room.query(`
      SELECT 
        c.id, 
        c.user_id, 
        u.username, 
        c.original_comment_text, 
        c.image_prompt, 
        c.generated_image_url, 
        c.created_at 
      FROM public.${COLLECTION_NAME} c
      JOIN public.user u ON c.user_id = u.id
      ORDER BY c.created_at DESC
    `)
  );

  useEffect(() => {
    const fetchAndProcessProjectComments = async () => {
      setProcessingStatus('Fetching project comments...');
      try {
        const project = await window.websim.getCurrentProject();
        if (!project || !project.id) {
          setProcessingStatus('Error: Could not get project information.');
          setTimeout(() => setProcessingStatus(''), 7000);
          return;
        }

        const response = await fetch(`/api/v1/projects/${project.id}/comments`);
        if (!response.ok) {
          throw new Error(`Failed to fetch comments: ${response.statusText} (status ${response.status})`);
        }
        const commentsData = await response.json();

        if (!commentsData.comments || !commentsData.comments.data || commentsData.comments.data.length === 0) {
          setProcessingStatus('No project comments found to process.');
          setTimeout(() => setProcessingStatus(''), 7000);
          return;
        }
        
        setProcessingStatus(`Processing ${commentsData.comments.data.length} comments...`);
        let newArtCreatedCount = 0;

        for (const commentItem of commentsData.comments.data) {
          const commentObject = commentItem.comment;
          
          if (!commentObject || !commentObject.author || !commentObject.author.id || !commentObject.content || commentObject.deleted) {
            console.warn('Skipping comment due to missing data or deleted status:', commentObject);
            continue;
          }

          const originalCommentText = extractTextFromDocumentNode(commentObject.content);
          const userId = commentObject.author.id;

          if (!originalCommentText.trim()) {
            console.log('Skipping comment with empty extracted text.');
            continue;
          }
          
          const existingEntries = await room.collection(COLLECTION_NAME).filter({
            user_id: userId,
            original_comment_text: originalCommentText,
          }).getList();

          if (existingEntries && existingEntries.length > 0) {
            continue;
          }

          console.log(`Generating image for comment: "${originalCommentText.substring(0,30)}..." by ${commentObject.author.username || userId}`);
          const imagePrompt = `White Blank Box in Center. ${originalCommentText}. White Blank Box in Center.`;
          
          try {
              const imageResult = await websim.imageGen({
                prompt: imagePrompt,
                aspect_ratio: "1:1",
              });

              if (!imageResult || !imageResult.url) {
                console.error("Image generation failed to return a URL for prompt:", imagePrompt);
                throw new Error("Image generation failed to return a URL.");
              }
              
              await room.collection(COLLECTION_NAME).create({
                user_id: userId,
                original_comment_text: originalCommentText,
                image_prompt: imagePrompt,
                generated_image_url: imageResult.url,
              });
              newArtCreatedCount++;
              console.log(`Art created for comment by ${commentObject.author.username || userId}`);
          } catch (imgGenError) {
              console.error(`Error during image generation or DB save for comment "${originalCommentText.substring(0,30)}...":`, imgGenError);
          }
        } 

        if (newArtCreatedCount > 0) {
            setProcessingStatus(`Processing complete. ${newArtCreatedCount} new art piece(s) created.`);
        } else {
            setProcessingStatus('Processing complete. No new art was created (existing comments likely processed).');
        }

      } catch (err) {
        console.error("Error processing project comments:", err);
        setProcessingStatus(`Error processing comments: ${err.message}`);
      } finally {
        setTimeout(() => {
            if (!processingStatus.toLowerCase().includes('error')) {
                setProcessingStatus('');
            }
        }, 7000);
      }
    };

    fetchAndProcessProjectComments();
  }, []); 

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center">
      <header className="w-full p-4 bg-gray-800 shadow-md fixed top-0 left-0 z-50">
        <h1 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">
          Recursive Comment Art
        </h1>
        {processingStatus && (
          <p className={`text-center mt-2 ${processingStatus.toLowerCase().includes('error') ? 'text-red-400' : 'text-green-400'}`}>
            {processingStatus}
          </p>
        )}
      </header>
      
      <main className="w-full h-screen pt-[80px] sm:pt-[70px]"> 
        {imagesLoading && !commentImages ? ( 
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