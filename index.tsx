
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

interface ArticleAnalysis {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
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
    publishedAt: string;
}

interface Headlines {
    leftHeadlines: Headline[];
    rightHeadlines: Headline[];
}

// FIX: Using a standard function declaration for `safeParseJson` to avoid ambiguity between generics and JSX syntax, which was causing widespread parser errors.
function safeParseJson<T>(jsonString: string): T {
  try {
      const startIndex = jsonString.indexOf('{');
      const endIndex = jsonString.lastIndexOf('}');
      if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
          throw new Error("Could not find a valid JSON object in the response.");
      }
      const jsonText = jsonString.substring(startIndex, endIndex + 1);
      return JSON.parse(jsonText) as T;
  } catch (e) {
      console.error("Failed to parse JSON response:", jsonString, e);
      throw new Error("The AI returned an invalid format. Please try again.");
  }
};

// FIX: Added type aliases for complex JSON response shapes to improve readability and prevent JSX parsing issues.
type FoundArticlesResponse = {
  rightWingArticle: { title: string; url: string; source: string; publishedAt: string; };
  leftWingArticle: { title: string; url: string; source: string; publishedAt: string; };
};

type AnalysisDataResponse = {
  rightWingArticleAnalysis: { summary: string; spinAnalysis: string; };
  leftWingArticleAnalysis: { summary: string; portrayalOfRight: string; };
  leftistTalkingPoints: string[];
  socialistTalkingPoints: string[];
  spectrumScore: number;
  spectrumJustification: string;
};


const App = () => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<Headlines | null>(null);
  const [latestHeadlines, setLatestHeadlines] = useState<Headline[] | null>(null);
  const [headlinesLoading, setHeadlinesLoading] = useState<boolean>(true);
  const [headlinesError, setHeadlinesError] = useState<string | null>(null);

  // State for global speech synthesis
  const [globalSpeechState, setGlobalSpeechState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [currentlySpeakingCard, setCurrentlySpeakingCard] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');

  const ai = useRef<GoogleGenAI | null>(null);
  const speechQueueRef = useRef<{ utterances: {utterance: SpeechSynthesisUtterance, cardId: string}[], currentIndex: number }>({ utterances: [], currentIndex: 0 });


  useEffect(() => {
    if (API_KEY) {
      ai.current = new GoogleGenAI({ apiKey: API_KEY });
      fetchHeadlines();
      
      const loadVoices = () => {
        if ('speechSynthesis' in window) {
            const availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                setVoices(availableVoices);
                
                // Intelligently select the best available voice as default
                const getBestVoice = (vcs: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
                    if (!vcs || vcs.length === 0) return null;
                    const lang = 'en-US';
                    const premiumNames = ['Google US English', 'Microsoft David - English (United States)', 'Samantha', 'Alex'];
                    for (const name of premiumNames) {
                        const voice = vcs.find(v => v.name === name && v.lang === lang);
                        if (voice) return voice;
                    }
                    const localVoice = vcs.find(v => v.lang === lang && v.localService);
                    if (localVoice) return localVoice;
                    const anyUSVoice = vcs.find(v => v.lang === lang);
                    if (anyUSVoice) return anyUSVoice;
                    return vcs.find(v => v.lang.startsWith('en')) || null;
                };

                const bestVoice = getBestVoice(availableVoices);
                if (bestVoice) {
                    setSelectedVoiceURI(bestVoice.voiceURI);
                } else if (availableVoices.length > 0) {
                    setSelectedVoiceURI(availableVoices[0].voiceURI);
                }

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
        contents: "Generate a list of recent, distinct news headlines from US media. IMPORTANT: The current date is August 28, 2025. All articles must be published within the last 3 months of this date (i.e., from June 2025 to August 2025). Provide 5 headlines typical of left-leaning sources (like CNN, MSNBC) and 5 from right-leaning sources (like FOX News, Daily Wire). For each headline, provide the source, an emoji that reflects its political tone, and the publication date. Use moderate emojis (e.g., 😐, 🤔) for center-leaning stories, and more extreme or 'crazy' emojis (e.g., 🤯, 😡, 🤡) for stories that are highly partisan or sensational.",
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
                    emoji: { type: Type.STRING, description: "A single emoji representing the tone." },
                    publishedAt: { type: Type.STRING, description: "The publication date of the article, ideally in ISO format."}
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
                    emoji: { type: Type.STRING, description: "A single emoji representing the tone." },
                    publishedAt: { type: Type.STRING, description: "The publication date of the article, ideally in ISO format."}
                  }
                },
                description: "5 headlines from right-leaning sources with source and emoji."
              },
            },
          },
        },
      });

      const responseText = response.text.trim();
      const parsedJson = JSON.parse(responseText) as Headlines;
      
      const allHeadlines = [...parsedJson.leftHeadlines, ...parsedJson.rightHeadlines];
      allHeadlines.sort((a, b) => {
          try {
              return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
          } catch (e) {
              return 0; // Don't sort if dates are invalid
          }
      });
      
      const latest = allHeadlines.slice(0, 2);
      setLatestHeadlines(latest);

      const latestHeadlinesSet = new Set(latest.map(h => h.headline));
      const remainingLeft = parsedJson.leftHeadlines.filter(h => !latestHeadlinesSet.has(h.headline));
      const remainingRight = parsedJson.rightHeadlines.filter(h => !latestHeadlinesSet.has(h.headline));

      const sortHeadlines = (headlines: Headline[]) => {
          return headlines.sort((a, b) => {
              try {
                  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
              } catch (e) {
                  return 0;
              }
          });
      };

      setHeadlines({
          leftHeadlines: sortHeadlines(remainingLeft),
          rightHeadlines: sortHeadlines(remainingRight)
      });

    } catch (err) {
      console.error("Error fetching headlines:", err);
      setHeadlinesError("Failed to fetch headlines.");
    } finally {
      setHeadlinesLoading(false);
    }
  };

  const getAnalysis = async (topic: string) => {
    setLoading(true);
    setLoadingMessage("Initializing analysis...");
    setError(null);
    setAnalysis(null);
    stopSpeech();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      if (!ai.current) throw new Error("AI client not initialized.");

      // Step 1: Find the articles using Google Search
      setLoadingMessage("Finding relevant articles...");
      const searchPrompt = `
        Find two representative news articles for the topic: "${topic}".
        1. One article should be from a source generally considered right-leaning in the US.
        2. The other article should be from a source generally considered left-leaning in the US.
        For each article, provide the title, the full URL, the source name, and the publication date.
        Your response must be a single, valid JSON object.`;
      
      const searchResponse = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: searchPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const parsedResponse = safeParseJson<any>(searchResponse.text);

      let rightWingArticle: any, leftWingArticle: any;

      const normalizeArticle = (article: any) => {
          if (!article) return null;
          // The AI sometimes returns publication_date. Normalize it.
          const publishedAt = article.publishedAt || article.publication_date;
          if (!publishedAt) {
              console.warn("Article missing publication date:", article);
          }
          return {
              ...article,
              publishedAt: publishedAt || new Date().toISOString(), // Fallback to now if date is missing
          };
      };

      if (parsedResponse.rightWingArticle && parsedResponse.leftWingArticle) {
          rightWingArticle = normalizeArticle(parsedResponse.rightWingArticle);
          leftWingArticle = normalizeArticle(parsedResponse.leftWingArticle);
      } else if (parsedResponse.articles && parsedResponse.articles.length >= 2) {
          setLoadingMessage("Classifying article perspectives...");
          const articlesToClassify = parsedResponse.articles.slice(0, 2);
          
          const classifyPrompt = `
              Given the following two articles, identify which one is from a right-leaning source.
              Article A: { "title": "${articlesToClassify[0].title}", "source": "${articlesToClassify[0].source}" }
              Article B: { "title": "${articlesToClassify[1].title}", "source": "${articlesToClassify[1].source}" }
  
              Your response MUST be a single, valid JSON object with one key: "rightWingArticleSource". The value should be the exact source name of the right-leaning article (e.g., "Fox News").`;
          
          const classifyResponse = await ai.current.models.generateContent({
              model: "gemini-2.5-flash",
              contents: classifyPrompt,
              config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                          rightWingArticleSource: { type: Type.STRING, description: "The exact source name of the right-leaning article." }
                      },
                      required: ["rightWingArticleSource"]
                  }
              }
          });
          
          const classification = safeParseJson<{rightWingArticleSource: string}>(classifyResponse.text);
          const rightSource = classification.rightWingArticleSource;

          const articleA = articlesToClassify[0];
          const articleB = articlesToClassify[1];

          if (articleA.source === rightSource) {
              rightWingArticle = normalizeArticle(articleA);
              leftWingArticle = normalizeArticle(articleB);
          } else {
              rightWingArticle = normalizeArticle(articleB);
              leftWingArticle = normalizeArticle(articleA);
          }
      }

      if (
        !rightWingArticle ||
        !leftWingArticle ||
        !rightWingArticle.title ||
        !leftWingArticle.title
      ) {
        console.error("The AI failed to structure its response correctly or find two distinct articles. Raw Response:", searchResponse.text);
        throw new Error("The AI could not find suitable left and right-leaning articles for this topic. Please try a different headline.");
      }


      // Step 2: Analyze the articles
      setLoadingMessage("Analyzing perspectives...");
      const analysisPrompt = `
        Analyze the news topic "${topic}" based on the two provided articles.

        Right-Leaning Article:
        - Title: ${rightWingArticle.title}
        - Source: ${rightWingArticle.source}
        - URL: ${rightWingArticle.url}

        Left-Leaning Article:
        - Title: ${leftWingArticle.title}
        - Source: ${leftWingArticle.source}
        - URL: ${leftWingArticle.url}

        Perform the following analysis:
        1. For the right-leaning article: Write a summary of its main arguments and identify its political 'spin' or narrative framing.
        2. For the left-leaning article: Write a summary of its main points and describe how it portrays the right-wing perspective on the topic.
        3. Distill and list the key 'talking points' from the left-leaning perspective that challenge or counter the right-wing narrative.
        4. Distill and list key 'talking points' from a socialist perspective, critiquing both mainstream narratives by focusing on class, labor, capitalism, or systemic issues.
        5. Assign a 'spectrumScore' from -10 (very liberal/left) to +10 (very conservative/right), where 0 is neutral, based on the topic's general framing in media.
        6. Provide a brief 'spectrumJustification' for the score.

        Your response must be a single, valid JSON object.`;
        
      const analysisResponse = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: analysisPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
                rightWingArticleAnalysis: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        spinAnalysis: { type: Type.STRING },
                    }
                },
                leftWingArticleAnalysis: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        portrayalOfRight: { type: Type.STRING },
                    }
                },
                leftistTalkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                socialistTalkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                spectrumScore: { type: Type.NUMBER },
                spectrumJustification: { type: Type.STRING },
            }
          }
        },
      });

      const analysisData = safeParseJson<AnalysisDataResponse>(analysisResponse.text);

      // Step 3: Combine results and set state
      const finalResult: AnalysisResult = {
        topic: topic,
        rightWingArticle: {
          ...rightWingArticle,
          summary: analysisData.rightWingArticleAnalysis.summary,
          spinAnalysis: analysisData.rightWingArticleAnalysis.spinAnalysis,
        },
        leftWingArticle: {
          ...leftWingArticle,
          summary: analysisData.leftWingArticleAnalysis.summary,
          portrayalOfRight: analysisData.leftWingArticleAnalysis.portrayalOfRight,
        },
        leftistTalkingPoints: analysisData.leftistTalkingPoints,
        socialistTalkingPoints: analysisData.socialistTalkingPoints,
        spectrumScore: analysisData.spectrumScore,
        spectrumJustification: analysisData.spectrumJustification,
      };

      setAnalysis(finalResult);

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unknown error occurred.");
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };
  
  const stopSpeech = () => {
    speechQueueRef.current = { utterances: [], currentIndex: 0 };
    if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
      window.speechSynthesis.cancel();
    }
    setGlobalSpeechState('stopped');
    setCurrentlySpeakingCard(null);
  };

  const resetView = () => {
    setAnalysis(null);
    setError(null);
    stopSpeech();
  };

  const handleGlobalSpeech = () => {
    const synth = window.speechSynthesis;
    if (!('speechSynthesis' in window) || !synth) {
        setError("Sorry, your browser does not support text-to-speech.");
        return;
    }

    if (globalSpeechState === 'playing') {
      synth.pause();
      setGlobalSpeechState('paused');
      return;
    } 
    
    if (globalSpeechState === 'paused') {
      synth.resume();
      setGlobalSpeechState('playing');
      return;
    }

    if (globalSpeechState === 'stopped' && analysis) {
      stopSpeech(); // Ensure a completely clean state before starting

      const speechQueue: { cardId: string; text: string }[] = [];

      const addToQueue = (cardId: string, text: string | undefined | null, shouldSplit = false) => {
          if (!text || text.trim().length === 0) return;
          if (shouldSplit) {
              // Split into sentences but keep delimiters.
              const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
              sentences.forEach(sentence => {
                  const trimmed = sentence.trim();
                  if (trimmed) speechQueue.push({ cardId, text: trimmed });
              });
          } else {
              speechQueue.push({ cardId, text });
          }
      };
      
      addToQueue('right-wing', 'Right-Wing Perspective.');
      addToQueue('right-wing', `Title: ${analysis.rightWingArticle.title}`);
      addToQueue('right-wing', `Source: ${analysis.rightWingArticle.source}`);
      addToQueue('right-wing', 'Summary:');
      addToQueue('right-wing', analysis.rightWingArticle.summary, true);
      addToQueue('right-wing', 'Narrative and Spin Analysis:');
      addToQueue('right-wing', analysis.rightWingArticle.spinAnalysis, true);
      
      addToQueue('left-wing', 'Left-Wing Perspective.');
      addToQueue('left-wing', `Title: ${analysis.leftWingArticle.title}`);
      addToQueue('left-wing', `Source: ${analysis.leftWingArticle.source}`);
      addToQueue('left-wing', 'Summary:');
      addToQueue('left-wing', analysis.leftWingArticle.summary, true);
      addToQueue('left-wing', 'Portrayal of Right-Wing View:');
      addToQueue('left-wing', analysis.leftWingArticle.portrayalOfRight, true);

      addToQueue('leftist-points', 'Leftist Talking Points.');
      analysis.leftistTalkingPoints.forEach(point => addToQueue('leftist-points', point, true));
      
      addToQueue('socialist-points', 'Socialist Talking Points.');
      analysis.socialistTalkingPoints.forEach(point => addToQueue('socialist-points', point, true));

      const preferredVoice = voices.find(v => v.voiceURI === selectedVoiceURI);

      const utterancesWithIds = speechQueue.map(item => {
        const utterance = new SpeechSynthesisUtterance(item.text);
        if (preferredVoice) utterance.voice = preferredVoice;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        
        utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
          console.error("Speech synthesis error event:", e);
          const errorMessage = e.error || 'unknown error';
          console.error(`Speech synthesis failed with error: ${errorMessage}`);
          setError(`Speech synthesis failed: ${errorMessage}. Please try a different voice or refresh the page.`);
          stopSpeech();
        };

        return { utterance, cardId: item.cardId };
      });

      if (utterancesWithIds.length > 0) {
        speechQueueRef.current = {
            utterances: utterancesWithIds,
            currentIndex: 0
        };

        const speakNext = () => {
            const { utterances, currentIndex } = speechQueueRef.current;
            if (currentIndex >= utterances.length) {
                stopSpeech(); // All finished
                return;
            }

            const currentItem = utterances[currentIndex];
            const currentUtterance = currentItem.utterance;

            currentUtterance.onstart = () => {
                setCurrentlySpeakingCard(currentItem.cardId);
            };

            currentUtterance.onend = () => {
                speechQueueRef.current.currentIndex++;
                setTimeout(speakNext, 50); // Small delay between utterances for stability
            };
            
            synth.speak(currentUtterance);
        };
        
        // Defensively reset the synth engine before starting
        synth.cancel();

        setGlobalSpeechState('playing');
        setTimeout(speakNext, 100); // Start the chain after a brief delay
      }
    }
  };
  
  const HeadlinesView = () => (
    <>
        {latestHeadlines && latestHeadlines.length > 0 && (
            <section className="latest-news-section">
                <h2>Latest Developments</h2>
                <ul>
                    {latestHeadlines.map((item, index) => (
                        <li key={`latest-${index}`}>
                            <button className="headline-button latest-headline-button" onClick={() => getAnalysis(item.headline)}>
                                <span className="headline-emoji">{item.emoji}</span>
                                <div className="headline-content">
                                    <span className="headline-text">{item.headline}</span>
                                    <div className="headline-meta">
                                        <span className="headline-source">{item.source}</span>
                                        <span className="headline-date">{new Date(item.publishedAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            </section>
        )}
        <section className="headlines-section">
            <div className="headlines-container">
                <div className="headlines-column">
                    <h2>Left-Leaning Headlines</h2>
                    <ul>
                        {headlines?.leftHeadlines.map((item, index) => (
                            <li key={`left-${index}`}>
                                <button className="headline-button" onClick={() => getAnalysis(item.headline)}>
                                    <span className="headline-emoji">{item.emoji}</span>
                                    <div className="headline-content">
                                        <span className="headline-text">{item.headline}</span>
                                        <div className="headline-meta">
                                            <span className="headline-source">{item.source}</span>
                                            <span className="headline-date">{new Date(item.publishedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="headlines-column">
                    <h2>Right-Leaning Headlines</h2>
                    <ul>
                        {headlines?.rightHeadlines.map((item, index) => (
                            <li key={`right-${index}`}>
                                <button className="headline-button" onClick={() => getAnalysis(item.headline)}>
                                    <span className="headline-emoji">{item.emoji}</span>
                                    <div className="headline-content">
                                        <span className="headline-text">{item.headline}</span>
                                        <div className="headline-meta">
                                            <span className="headline-source">{item.source}</span>
                                            <span className="headline-date">{new Date(item.publishedAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    </>
  );

  const Results = () => (
    <div className="results-container">
        <div className="results-controls">
            <button className="back-button" onClick={resetView}>&larr; Back to Headlines</button>
            <div className="speech-controls">
                {voices.length > 0 && (
                    <div className="voice-selector">
                        <label htmlFor="voice-select">Voice:</label>
                        <select id="voice-select" value={selectedVoiceURI} onChange={e => setSelectedVoiceURI(e.target.value)}>
                            {voices.map(voice => (
                                <option key={voice.voiceURI} value={voice.voiceURI}>
                                    {voice.name} ({voice.lang})
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                <button onClick={handleGlobalSpeech} className="global-read-aloud-button">
                    {globalSpeechState === 'playing' && <PauseIcon />}
                    {globalSpeechState === 'paused' && <PlayIcon />}
                    {globalSpeechState === 'stopped' && <SpeakerIcon />}
                    <span>
                        {globalSpeechState === 'stopped' && 'Read Full Analysis'}
                        {globalSpeechState === 'playing' && 'Pause Reading'}
                        {globalSpeechState === 'paused' && 'Resume Reading'}
                    </span>
                </button>
            </div>
        </div>
        <div className={`card topic-card ${currentlySpeakingCard === 'topic' ? 'is-speaking' : ''}`}>
            <div className="card-header">
                <h2>{analysis!.topic}</h2>
            </div>
        </div>
        <div className={`card spectrum-meter ${currentlySpeakingCard === 'spectrum' ? 'is-speaking' : ''}`}>
            <div className="card-header">
                <h2>Political Spectrum Score</h2>
            </div>
            <div className="spectrum-track">
                <div className="spectrum-marker" style={{ left: `${((analysis!.spectrumScore + 10) / 20) * 100}%` }}></div>
            </div>
            <div className="spectrum-labels">
                <span>Liberal</span>
                <span>Neutral</span>
                <span>Conservative</span>
            </div>
            <p className="spectrum-justification">{analysis!.spectrumJustification}</p>
        </div>
        <div className={`card right-wing-card ${currentlySpeakingCard === 'right-wing' ? 'is-speaking' : ''}`}>
            <div className="card-header">
                <h2>Right-Wing Perspective</h2>
            </div>
            <h3><a href={analysis!.rightWingArticle.url} target="_blank" rel="noopener noreferrer">{analysis!.rightWingArticle.title}</a></h3>
            <p className="article-date"><strong>Source:</strong> {analysis!.rightWingArticle.source} | <strong>Published:</strong> {new Date(analysis!.rightWingArticle.publishedAt).toLocaleDateString()}</p>
            <h4>Summary</h4>
            <p>{analysis!.rightWingArticle.summary}</p>
            <h4>Narrative and Spin Analysis</h4>
            <p>{analysis!.rightWingArticle.spinAnalysis}</p>
        </div>
        <div className={`card left-wing-card ${currentlySpeakingCard === 'left-wing' ? 'is-speaking' : ''}`}>
            <div className="card-header">
                <h2>Left-Wing Perspective</h2>
            </div>
            <h3><a href={analysis!.leftWingArticle.url} target="_blank" rel="noopener noreferrer">{analysis!.leftWingArticle.title}</a></h3>
            <p className="article-date"><strong>Source:</strong> {analysis!.leftWingArticle.source} | <strong>Published:</strong> {new Date(analysis!.leftWingArticle.publishedAt).toLocaleDateString()}</p>
            <h4>Summary</h4>
            <p>{analysis!.leftWingArticle.summary}</p>
            <h4>Portrayal of Right-Wing View</h4>
            <p>{analysis!.leftWingArticle.portrayalOfRight}</p>
        </div>
        <div className={`card talking-points left-wing-card ${currentlySpeakingCard === 'leftist-points' ? 'is-speaking' : ''}`}>
             <div className="card-header">
                <h2>Leftist Talking Points</h2>
            </div>
            <ul>
                {analysis!.leftistTalkingPoints.map((point, index) => <li key={index}>{point}</li>)}
            </ul>
        </div>
        <div className={`card talking-points socialist-card ${currentlySpeakingCard === 'socialist-points' ? 'is-speaking' : ''}`}>
             <div className="card-header">
                <h2>Socialist Talking Points</h2>
            </div>
            <ul>
                {analysis!.socialistTalkingPoints.map((point, index) => <li key={index}>{point}</li>)}
            </ul>
        </div>
    </div>
  );

  return (
    <main>
      <header>
        <h1>Political News Spectrum</h1>
        <p>See the narratives from all sides. Select a headline to get a balanced analysis of the different perspectives.</p>
      </header>
      
      {loading && (
        <div className="loader-container">
            <div className="loader"></div>
            <p className="loading-message">{loadingMessage}</p>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {analysis ? <Results /> : (
        headlinesLoading ? (
            <div className="loader-container">
                <div className="loader"></div>
                <p className="loading-message">Fetching latest headlines...</p>
            </div>
        ) : headlinesError ? (
            <div className="error">{headlinesError}</div>
        ) : headlines ? (
            <HeadlinesView />
        ) : null
      )}
    </main>
  );
};

const SpeakerIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
        <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
        <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06"/>
    </svg>
);

const PauseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
    </svg>
);

const PlayIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
    </svg>
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
