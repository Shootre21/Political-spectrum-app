import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

interface ArticleAnalysis {
  title: string;
  url: string;
  source: string;
  summary: string;
  spinAnalysis?: string;
  portrayalOfRight?: string;
}

interface AnalysisResult {
  topic: string;
  rightWingArticle: ArticleAnalysis;
  leftWingArticle: ArticleAnalysis;
  leftistTalkingPoints: string[];
  socialistTalkingPoints: string[];
  spectrumScore: number;
  spectrumJustification: string;
}

interface Headline {
    headline: string;
    source: string;
    emoji: string;
}

interface Headlines {
    leftHeadlines: Headline[];
    rightHeadlines: Headline[];
}


const App = () => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<Headlines | null>(null);
  const [headlinesLoading, setHeadlinesLoading] = useState<boolean>(true);
  const [headlinesError, setHeadlinesError] = useState<string | null>(null);

  // State for global speech synthesis
  const [globalSpeechState, setGlobalSpeechState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [currentlySpeakingCard, setCurrentlySpeakingCard] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceQueueRef = useRef<{utterance: SpeechSynthesisUtterance, cardId: string}[]>([]);
  const currentUtteranceIndexRef = useRef<number>(0);

  const ai = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    if (API_KEY) {
      ai.current = new GoogleGenAI({ apiKey: API_KEY });
      fetchHeadlines();
      
      const loadVoices = () => {
        if ('speechSynthesis' in window) {
            const availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                setVoices(availableVoices);
                window.speechSynthesis.onvoiceschanged = null; 
            }
        }
      };
      
      loadVoices();
      if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }

      return () => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
      }
    } else {
        setHeadlinesError("API_KEY is not set.");
        setError("API_KEY is not set. Please check your environment variables.");
        setHeadlinesLoading(false);
    }
  }, []);

  const fetchHeadlines = async () => {
    setHeadlinesLoading(true);
    setHeadlinesError(null);
    try {
      if (!ai.current) throw new Error("AI client not initialized.");

      const response = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Generate a list of recent, distinct news headlines from US media. Provide 5 headlines typical of left-leaning sources (like CNN, MSNBC) and 5 from right-leaning sources (like FOX News, Daily Wire). For each headline, provide the source and an emoji that reflects its political tone. Use moderate emojis (e.g., 😐, 🤔) for center-leaning stories, and more extreme or 'crazy' emojis (e.g., 🤯, 😡, 🤡) for stories that are highly partisan or sensational.",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              leftHeadlines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    source: { type: Type.STRING },
                    emoji: { type: Type.STRING, description: "A single emoji representing the tone." }
                  }
                },
                description: "5 headlines from left-leaning sources with source and emoji."
              },
              rightHeadlines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    source: { type: Type.STRING },
                    emoji: { type: Type.STRING, description: "A single emoji representing the tone." }
                  }
                },
                description: "5 headlines from right-leaning sources with source and emoji."
              },
            },
          },
        },
      });

      const responseText = response.text.trim();
      const parsedJson = JSON.parse(responseText);
      setHeadlines(parsedJson);
    } catch (err) {
      console.error("Error fetching headlines:", err);
      setHeadlinesError("Failed to fetch headlines.");
    } finally {
      setHeadlinesLoading(false);
    }
  };

  const getAnalysis = async (topic: string) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    stopSpeech();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      if (!ai.current) throw new Error("AI client not initialized.");

      const prompt = `
        Analyze the following news topic: "${topic}".

        For this topic, please perform the following actions using Google Search for grounding:
        1.  Find one representative news article from a source generally considered right-leaning.
        2.  Find one representative news article from a source generally considered left-leaning that covers the same event or topic.
        3.  Analyze the right-leaning article to summarize its main arguments and identify its political 'spin' or narrative framing.
        4.  Analyze the left-leaning article, summarize its points, and describe how it portrays the right-wing perspective.
        5.  Distill and list the key 'talking points' from the left-leaning perspective that challenge or counter the right-wing narrative.
        6.  Distill and list key 'talking points' from a socialist perspective. These points should critique both the right-wing and left-wing (liberal) narratives, focusing on underlying class interests, labor, the role of capitalism, or systemic issues that both mainstream perspectives might ignore.
        7.  Based on the topic's framing and typical media coverage, assign a 'spectrumScore' from -10 (very liberal/left) to +10 (very conservative/right), where 0 is neutral.
        8.  Provide a brief 'spectrumJustification' explaining the reasoning for the score.

        IMPORTANT: Your entire response MUST be a single, valid JSON object. Do not include any text, explanations, or markdown formatting like \`\`\`json before or after the JSON object.

        The JSON object must follow this exact structure:
        {
          "topic": "string",
          "rightWingArticle": {
            "title": "string",
            "url": "string",
            "source": "string",
            "summary": "string",
            "spinAnalysis": "string"
          },
          "leftWingArticle": {
            "title": "string",
            "url": "string",
            "source": "string",
            "summary": "string",
            "portrayalOfRight": "string"
          },
          "leftistTalkingPoints": ["string"],
          "socialistTalkingPoints": ["string"],
          "spectrumScore": "number",
          "spectrumJustification": "string"
        }
      `;

      const response = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      
      const responseText = response.text.trim();
      
      const startIndex = responseText.indexOf('{');
      const endIndex = responseText.lastIndexOf('}');

      if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
          console.error("Failed to find JSON object in response:", responseText);
          throw new Error("The AI returned a response that did not contain a valid JSON object. Please try again.");
      }
      
      const jsonText = responseText.substring(startIndex, endIndex + 1);

      try {
        const parsedJson = JSON.parse(jsonText);
        setAnalysis(parsedJson);
      } catch (e) {
         console.error("Failed to parse JSON response:", jsonText, e);
         throw new Error("The AI returned an invalid format. Please try again.");
      }

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unknown error occurred.");
    } finally {
      setLoading(false);
    }
  };
  
  const stopSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setGlobalSpeechState('stopped');
    setCurrentlySpeakingCard(null);
    currentUtteranceIndexRef.current = 0;
    utteranceQueueRef.current = [];
  };

  const resetView = () => {
    setAnalysis(null);
    setError(null);
    stopSpeech();
  };

  const handleGlobalSpeech = () => {
    if (!('speechSynthesis' in window)) {
        setError("Sorry, your browser does not support text-to-speech.");
        return;
    }

    if (globalSpeechState === 'playing') {
      window.speechSynthesis.pause();
      setGlobalSpeechState('paused');
    } else if (globalSpeechState === 'paused') {
      window.speechSynthesis.resume();
      setGlobalSpeechState('playing');
    } else if (globalSpeechState === 'stopped' && analysis) {
      // Before starting, cancel any lingering speech and reset our index.
      // This ensures we start from a clean state.
      window.speechSynthesis.cancel();
      currentUtteranceIndexRef.current = 0;

      const textToSpeak = [
        {
          cardId: 'right-wing',
          text: `Right-Wing Perspective. Title: ${analysis.rightWingArticle.title}. Source: ${analysis.rightWingArticle.source}. Summary: ${analysis.rightWingArticle.summary}. Narrative and Spin Analysis: ${analysis.rightWingArticle.spinAnalysis}`
        },
        {
          cardId: 'left-wing',
          text: `Left-Wing Perspective. Title: ${analysis.leftWingArticle.title}. Source: ${analysis.leftWingArticle.source}. Summary: ${analysis.leftWingArticle.summary}. Portrayal of Right-Wing View: ${analysis.leftWingArticle.portrayalOfRight}`
        },
        {
          cardId: 'leftist-points',
          text: `Leftist Talking Points. ${analysis.leftistTalkingPoints.join('. ')}`
        },
        {
          cardId: 'socialist-points',
          text: `Socialist Talking Points. ${analysis.socialistTalkingPoints.join('. ')}`
        }
      ];

      const preferredVoice = voices.find(voice => voice.name.includes('Google') && voice.lang === 'en-US') 
        || voices.find(voice => voice.lang === 'en-US' && voice.localService) 
        || voices.find(voice => voice.lang === 'en-US') 
        || voices.find(voice => voice.lang.startsWith('en')) 
        || null;

      utteranceQueueRef.current = textToSpeak.map(item => {
        const utterance = new SpeechSynthesisUtterance(item.text);
        if (preferredVoice) utterance.voice = preferredVoice;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        return { utterance, cardId: item.cardId };
      });

      const speakNext = () => {
        if (currentUtteranceIndexRef.current >= utteranceQueueRef.current.length) {
          stopSpeech();
          return;
        }

        const currentItem = utteranceQueueRef.current[currentUtteranceIndexRef.current];
        
        currentItem.utterance.onstart = () => {
          setCurrentlySpeakingCard(currentItem.cardId);
        };

        currentItem.utterance.onend = () => {
          currentUtteranceIndexRef.current++;
          speakNext();
        };

        currentItem.utterance.onerror = (e) => {
          console.error("Speech synthesis error:", e);
          setError("An error occurred during speech synthesis.");
          stopSpeech();
        };

        window.speechSynthesis.speak(currentItem.utterance);
      };
      
      setGlobalSpeechState('playing');
      
      // A small delay helps prevent race conditions in some browsers where
      // a `speak` command is issued too quickly after a `cancel`.
      setTimeout(() => {
        speakNext();
      }, 100);
    }
  };
  
  const SpeakerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-1.414 1.414A6.47 6.47 0 0 1 12.025 8a6.47 6.47 0 0 1-1.904 4.596z"/>
      <path d="M10.121 12.596A6.47 6.47 0 0 0 12.025 8a6.47 6.47 0 0 0-1.904-4.596l-1.414 1.414A4.47 4.47 0 0 1 10.025 8a4.47 4.47 0 0 1-1.318 3.182z"/>
      <path d="M8.707 11.182A2.47 2.47 0 0 0 9.025 8a2.47 2.47 0 0 0-.318-1.182L7.293 8.293A1.47 1.47 0 0 1 7.525 8a1.47 1.47 0 0 1-.232.886zM6.5 12a5.5 5.5 0 0 1-5.5-5.5v-1a5.5 5.5 0 0 1 5.5-5.5h1a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5z"/>
    </svg>
  );

  const PauseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M6 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zm4 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5z"/>
    </svg>
  );

  const getGlobalButtonContent = () => {
    if (globalSpeechState === 'playing') {
      return { Icon: PauseIcon, text: 'Pause Analysis' };
    }
    if (globalSpeechState === 'paused') {
      return { Icon: SpeakerIcon, text: 'Resume Analysis' };
    }
    return { Icon: SpeakerIcon, text: 'Read Full Analysis' };
  };

  const SpectrumMeter = ({ score, justification }: { score: number; justification: string }) => {
    const percentage = ((score + 10) / 20) * 100;
    const markerPosition = `calc(${percentage}% - 8px)`;

    return (
        <div className="card spectrum-meter">
            <div className="card-header">
                <h2>Political Spectrum Analysis</h2>
            </div>
            <div className="spectrum-track">
                <div className="spectrum-marker" style={{ left: markerPosition }} title={`Score: ${score}`}></div>
            </div>
            <div className="spectrum-labels">
                <span>-10 Far Left</span>
                <span>Center</span>
                <span>+10 Far Right</span>
            </div>
            <p className="spectrum-justification"><strong>Justification:</strong> {justification}</p>
        </div>
    );
  };

  return (
    <main>
        <header>
          <h1>Political News Spectrum</h1>
          <p>
            Explore how different political spectrums report on the same story.
            This tool analyzes right, left, and socialist perspectives to reveal spin,
            narratives, and key talking points.
          </p>
        </header>

        {loading && <div className="loader" aria-label="Loading content"></div>}
        {error && (
            <div className="error" role="alert">
                <p><strong>Error:</strong> {error}</p>
                {analysis && <button onClick={resetView}>Back to Headlines</button>}
            </div>
        )}
        
        {!analysis && !loading && (
             <div className="headlines-section">
                {headlinesLoading && <div className="loader" aria-label="Loading headlines"></div>}
                {headlinesError && <div className="error" role="alert"><p>{headlinesError}</p></div>}
                {headlines && (
                    <div className="headlines-container">
                        <div className="headlines-column">
                            <h2>Left-Leaning Headlines</h2>
                            <ul>
                                {headlines.leftHeadlines.map((item, index) => (
                                    <li key={`left-${index}`}>
                                        <button className="headline-button" onClick={() => getAnalysis(item.headline)}>
                                            <span className="headline-emoji">{item.emoji}</span>
                                            <div className="headline-content">
                                                <span className="headline-text">{item.headline}</span>
                                                <span className="headline-source">{item.source}</span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="headlines-column">
                            <h2>Right-Leaning Headlines</h2>
                             <ul>
                                {headlines.rightHeadlines.map((item, index) => (
                                    <li key={`right-${index}`}>
                                        <button className="headline-button" onClick={() => getAnalysis(item.headline)}>
                                             <span className="headline-emoji">{item.emoji}</span>
                                            <div className="headline-content">
                                                <span className="headline-text">{item.headline}</span>
                                                <span className="headline-source">{item.source}</span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        )}
        
        {analysis && !loading && (
          <div className="results-container" aria-live="polite">
            <div className="results-controls">
                <button className="back-button" onClick={resetView}>← Back to Headlines</button>
                {(() => {
                  const { Icon, text } = getGlobalButtonContent();
                  return (
                    <button className="global-read-aloud-button" onClick={handleGlobalSpeech} aria-label={text}>
                       <Icon /> {text}
                    </button>
                  );
                })()}
            </div>
            <div className="card topic-card">
              <div className="card-header">
                <h2>Topic</h2>
              </div>
              <p>{analysis.topic}</p>
            </div>

            <SpectrumMeter score={analysis.spectrumScore} justification={analysis.spectrumJustification} />

            <div className={`card right-wing-card ${currentlySpeakingCard === 'right-wing' ? 'is-speaking' : ''}`}>
              <div className="card-header">
                <h2>Right-Wing Perspective</h2>
              </div>
              <h3><a href={analysis.rightWingArticle.url} target="_blank" rel="noopener noreferrer">{analysis.rightWingArticle.title}</a></h3>
              <p><strong>Source:</strong> {analysis.rightWingArticle.source}</p>
              <h4>Summary</h4>
              <p>{analysis.rightWingArticle.summary}</p>
              <h4>Narrative & Spin Analysis</h4>
              <p>{analysis.rightWingArticle.spinAnalysis}</p>
            </div>

            <div className={`card left-wing-card ${currentlySpeakingCard === 'left-wing' ? 'is-speaking' : ''}`}>
              <div className="card-header">
                <h2>Left-Wing Perspective</h2>
              </div>
              <h3><a href={analysis.leftWingArticle.url} target="_blank" rel="noopener noreferrer">{analysis.leftWingArticle.title}</a></h3>
              <p><strong>Source:</strong> {analysis.leftWingArticle.source}</p>
              <h4>Summary</h4>
              <p>{analysis.leftWingArticle.summary}</p>
              <h4>Portrayal of Right-Wing View</h4>
              <p>{analysis.leftWingArticle.portrayalOfRight}</p>
            </div>

            <div className={`card left-wing-card talking-points ${currentlySpeakingCard === 'leftist-points' ? 'is-speaking' : ''}`}>
              <div className="card-header">
                <h2>Leftist Talking Points</h2>
              </div>
              <ul>
                {analysis.leftistTalkingPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </div>

            <div className={`card socialist-card talking-points ${currentlySpeakingCard === 'socialist-points' ? 'is-speaking' : ''}`}>
              <div className="card-header">
                <h2>Socialist Talking Points</h2>
              </div>
              <ul>
                {analysis.socialistTalkingPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </div>

          </div>
        )}
    </main>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<App />);