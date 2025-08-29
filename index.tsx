
import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

// Simplified analysis result for a single article
interface AnalysisResult {
  topic: string;
  article: {
    title: string;
    url: string;
    source: string;
    publishedAt: string;
  };
  category: string;
  popularity: {
    score: string;
    justification: string;
  };
  wasEdited: {
    status: boolean;
    reasoning: string;
  };
  rightWingPerspective: {
    summary: string;
    talkingPoints: string[];
  };
  leftWingPerspective: {
    summary: string;
    talkingPoints: string[];
  };
  socialistPerspective: {
    summary: string;
    talkingPoints: string[];
  };
  spectrumScore: number;
  spectrumJustification: string;
}

interface Headline {
    headline: string;
    source: string;
    emoji: string;
    publishedAt: string;
    url: string;
}

interface Headlines {
    leftHeadlines: Headline[];
    rightHeadlines: Headline[];
}

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

const App = () => {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [headlines, setHeadlines] = useState<Headlines | null>(null);
  const [latestHeadlines, setLatestHeadlines] = useState<Headline[] | null>(null);
  const [tickerHeadlines, setTickerHeadlines] = useState<Headline[]>([]);
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
      fetchTickerHeadlines();
      const tickerInterval = setInterval(fetchTickerHeadlines, 5 * 60 * 1000); // Refresh every 5 minutes
      
      const loadVoices = () => {
        if ('speechSynthesis' in window) {
            const availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                setVoices(availableVoices);
                
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
        clearInterval(tickerInterval);
      }
    } else {
        setHeadlinesError("API_KEY is not set.");
        setError("API_KEY is not set. Please check your environment variables.");
        setHeadlinesLoading(false);
    }
  }, []);

  const fetchTickerHeadlines = async () => {
    try {
        if (!ai.current) return;
        const response = await ai.current.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Generate a list of 10 breaking news headlines from major US media outlets from the last 24-48 hours. For each, provide the headline, source, and full URL.",
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        headlines: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    headline: { type: Type.STRING },
                                    source: { type: Type.STRING },
                                    url: { type: Type.STRING },
                                }
                            }
                        }
                    }
                }
            }
        });
        const parsed = JSON.parse(response.text.trim()) as { headlines: Omit<Headline, 'emoji' | 'publishedAt'>[] };
        const headlinesWithDefaults = parsed.headlines.map(h => ({
            ...h,
            emoji: '⚡️',
            publishedAt: new Date().toISOString(),
        }));
        setTickerHeadlines(headlinesWithDefaults);
    } catch (err) {
        console.error("Failed to fetch ticker headlines:", err);
    }
  };

  const fetchHeadlines = async () => {
    setHeadlinesLoading(true);
    setHeadlinesError(null);
    try {
      if (!ai.current) throw new Error("AI client not initialized.");

      const response = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Generate a list of recent, distinct news headlines from US media. IMPORTANT: The current date is August 28, 2025. All articles must be published within the last 3 months of this date (i.e., from June 2025 to August 2025). Provide 5 headlines typical of left-leaning sources (like CNN, MSNBC) and 5 from right-leaning sources (like FOX News, Daily Wire). For each headline, provide the source, the full URL to the article, an emoji that reflects its political tone, and the publication date. Use moderate emojis (e.g., 😐, 🤔) for center-leaning stories, and more extreme or 'crazy' emojis (e.g., 🤯, 😡, 🤡) for highly partisan or sensational stories.",
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
                    url: { type: Type.STRING },
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
                    url: { type: Type.STRING },
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
              return 0; 
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

  const getAnalysis = async (headline: Headline) => {
    setLoading(true);
    setLoadingMessage("Analyzing perspective...");
    setError(null);
    setAnalysis(null);
    stopSpeech();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      if (!ai.current) throw new Error("AI client not initialized.");
      
      const analysisPrompt = `
        Analyze the news article provided below.

        Article to Analyze:
        - Title: ${headline.headline}
        - Source: ${headline.source}
        - URL: ${headline.url}

        Perform the following analysis and provide your response as a single, valid JSON object:

        1.  **Category Tag**: Classify the article's topic into one of the following: "National News", "World News", "Politics", "Technology", "Business", "Culture", or "Local News".
        2.  **Popularity Analysis**: Estimate the article's reach and popularity (score: "Low", "Medium", "High", or "Viral") and provide a brief justification for your score based on the source and topic.
        3.  **Edited Status**: Analyze the content for any indications that the article was significantly edited or updated after its initial publication. Note the status (true/false) and provide reasoning, such as finding phrases like "This story has been updated".
        4.  **Right-Wing Perspective**:
            -   Provide a 'summary' of how a conservative or right-leaning individual would likely interpret the key information in this article.
            -   List the key 'talkingPoints' they would derive from it.
        5.  **Left-Wing Perspective**:
            -   Provide a 'summary' of how a liberal or left-leaning individual would likely interpret the key information in this article.
            -   List the key 'talkingPoints' they would derive from it.
        6.  **Socialist Perspective**:
            -   Provide a 'summary' of how a socialist would critique the article's framing, focusing on class, labor, capitalism, or systemic issues.
            -   List the key 'talkingPoints' from this perspective.
        7.  **Spectrum Score**: Assign a 'spectrumScore' from -10 (very liberal/left) to +10 (very conservative/right) for the article's own bias.
        8.  **Spectrum Justification**: Provide a brief 'spectrumJustification' for the score.`;
        
      const analysisResponse = await ai.current.models.generateContent({
        model: "gemini-2.5-flash",
        contents: analysisPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
                category: { type: Type.STRING },
                popularity: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.STRING },
                        justification: { type: Type.STRING },
                    }
                },
                wasEdited: {
                    type: Type.OBJECT,
                    properties: {
                        status: { type: Type.BOOLEAN },
                        reasoning: { type: Type.STRING },
                    }
                },
                rightWingPerspective: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        talkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                    }
                },
                leftWingPerspective: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        talkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                    }
                },
                socialistPerspective: {
                    type: Type.OBJECT,
                    properties: {
                        summary: { type: Type.STRING },
                        talkingPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                    }
                },
                spectrumScore: { type: Type.NUMBER },
                spectrumJustification: { type: Type.STRING },
            }
          }
        },
      });

      const analysisData = safeParseJson<any>(analysisResponse.text);

      const finalResult: AnalysisResult = {
        topic: headline.headline,
        article: {
          title: headline.headline,
          url: headline.url,
          source: headline.source,
          publishedAt: headline.publishedAt,
        },
        ...analysisData
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
      stopSpeech(); 

      const speechQueue: { cardId: string; text: string }[] = [];

      const addToQueue = (cardId: string, text: string | undefined | null, shouldSplit = false) => {
          if (!text || text.trim().length === 0) return;
          if (shouldSplit) {
              const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
              sentences.forEach(sentence => {
                  const trimmed = sentence.trim();
                  if (trimmed) speechQueue.push({ cardId, text: trimmed });
              });
          } else {
              speechQueue.push({ cardId, text });
          }
      };
      
      addToQueue('article-details', `Analyzing the article: ${analysis.article.title}.`);
      addToQueue('article-details', `Source: ${analysis.article.source}.`);
      addToQueue('article-details', `Category: ${analysis.category}.`);
      addToQueue('article-details', `Popularity Score: ${analysis.popularity.score}.`);
      addToQueue('article-details', analysis.popularity.justification, true);

      addToQueue('left-wing', 'Left-Wing Perspective.');
      addToQueue('left-wing', analysis.leftWingPerspective.summary, true);
      addToQueue('left-wing', "Key talking points include:");
      analysis.leftWingPerspective.talkingPoints.forEach(point => addToQueue('left-wing', point, true));
      
      addToQueue('right-wing', 'Right-Wing Perspective.');
      addToQueue('right-wing', analysis.rightWingPerspective.summary, true);
      addToQueue('right-wing', "Key talking points include:");
      analysis.rightWingPerspective.talkingPoints.forEach(point => addToQueue('right-wing', point, true));
      
      addToQueue('socialist', 'Socialist Perspective.');
      addToQueue('socialist', analysis.socialistPerspective.summary, true);
      addToQueue('socialist', "Key talking points include:");
      analysis.socialistPerspective.talkingPoints.forEach(point => addToQueue('socialist', point, true));

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
                stopSpeech(); 
                return;
            }

            const currentItem = utterances[currentIndex];
            const currentUtterance = currentItem.utterance;

            currentUtterance.onstart = () => {
                setCurrentlySpeakingCard(currentItem.cardId);
            };

            currentUtterance.onend = () => {
                speechQueueRef.current.currentIndex++;
                setTimeout(speakNext, 50); 
            };
            
            synth.speak(currentUtterance);
        };
        
        synth.cancel();

        setGlobalSpeechState('playing');
        setTimeout(speakNext, 100); 
      }
    }
  };
  
  const NewsTicker = ({ headlines, onHeadlineClick }: { headlines: Headline[]; onHeadlineClick: (headline: Headline) => void; }) => {
    if (!headlines || headlines.length === 0) {
        return null;
    }

    // Duplicate headlines for seamless scrolling effect
    const tickerItems = [...headlines, ...headlines];

    return (
        <div className="news-ticker-container" aria-label="Latest News Ticker">
            <div className="ticker-content">
                {tickerItems.map((item, index) => (
                    <button key={index} className="ticker-item" onClick={() => onHeadlineClick(item)}>
                        <span className="ticker-source">{item.source}</span>
                        <span className="ticker-headline">{item.headline}</span>
                    </button>
                ))}
            </div>
        </div>
    );
  };

  const HeadlinesView = () => (
    <>
        {latestHeadlines && latestHeadlines.length > 0 && (
            <section className="latest-news-section">
                <h2>Latest Developments</h2>
                <ul>
                    {latestHeadlines.map((item, index) => (
                        <li key={`latest-${index}`}>
                            <button className="headline-button latest-headline-button" onClick={() => getAnalysis(item)}>
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
                                <button className="headline-button" onClick={() => getAnalysis(item)}>
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
                                <button className="headline-button" onClick={() => getAnalysis(item)}>
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

        <div className={`card article-details-card ${currentlySpeakingCard === 'article-details' ? 'is-speaking' : ''}`}>
            <div className="card-header">
                <h2>Article Analysis</h2>
            </div>
            <h3><a href={analysis!.article.url} target="_blank" rel="noopener noreferrer">{analysis!.article.title}</a></h3>
            <p className="article-date"><strong>Source:</strong> {analysis!.article.source} | <strong>Published:</strong> {new Date(analysis!.article.publishedAt).toLocaleDateString()}</p>
            <div className="analytics-grid">
                <div><strong>Category:</strong> {analysis!.category}</div>
                <div><strong>Popularity:</strong> {analysis!.popularity.score}</div>
                <div><strong>Edited:</strong> {analysis!.wasEdited.status ? 'Yes' : 'No'}</div>
            </div>
            <p className="analytics-justification"><strong>Popularity Rationale:</strong> {analysis!.popularity.justification}</p>
            <p className="analytics-justification"><strong>Edit Status Rationale:</strong> {analysis!.wasEdited.reasoning}</p>
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

        <div className="perspectives-container">
            <div className={`card left-wing-card ${currentlySpeakingCard === 'left-wing' ? 'is-speaking' : ''}`}>
                <div className="card-header"><h2>Left-Wing Perspective</h2></div>
                <h4>Summary</h4>
                <p>{analysis!.leftWingPerspective.summary}</p>
                <h4>Talking Points</h4>
                <ul>{analysis!.leftWingPerspective.talkingPoints.map((point, index) => <li key={`lw-${index}`}>{point}</li>)}</ul>
            </div>

            <div className={`card right-wing-card ${currentlySpeakingCard === 'right-wing' ? 'is-speaking' : ''}`}>
                <div className="card-header"><h2>Right-Wing Perspective</h2></div>
                <h4>Summary</h4>
                <p>{analysis!.rightWingPerspective.summary}</p>
                <h4>Talking Points</h4>
                <ul>{analysis!.rightWingPerspective.talkingPoints.map((point, index) => <li key={`rw-${index}`}>{point}</li>)}</ul>
            </div>

            <div className={`card socialist-card ${currentlySpeakingCard === 'socialist' ? 'is-speaking' : ''}`}>
                <div className="card-header"><h2>Socialist Perspective</h2></div>
                <h4>Summary</h4>
                <p>{analysis!.socialistPerspective.summary}</p>
                <h4>Talking Points</h4>
                <ul>{analysis!.socialistPerspective.talkingPoints.map((point, index) => <li key={`s-${index}`}>{point}</li>)}</ul>
            </div>
        </div>
    </div>
  );

  return (
    <main>
      <header>
        <h1>Political News Spectrum</h1>
        <p>See the narratives from all sides. Select a headline to get a balanced analysis of the different perspectives.</p>
      </header>
      
      <NewsTicker headlines={tickerHeadlines} onHeadlineClick={getAnalysis} />

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
