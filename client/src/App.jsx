import { useState, useRef, useEffect } from "react";

export default function App() {
  const API_BASE_URL = "http://localhost:3001"; // Centralized API base URL
  
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const fileInputRef = useRef(null);
  const resultsRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  // Check API health on component mount
  useEffect(() => {
    checkApiHealth();
  }, []);

  const checkApiHealth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        setApiStatus("connected");
      } else {
        setApiStatus("error");
      }
    } catch (error) {
      console.error("API health check failed:", error);
      setApiStatus("error");
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (file) => {
    if (file.type !== "application/pdf") {
      setError("Only PDF files are allowed");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("File size exceeds 5MB limit");
      return;
    }

    setFile(file);
    setError(null);
  };

  const extractMatchScore = (analysisText) => {
    // Try different regex patterns to extract match score
    const patterns = [
      /Match Percentage:.*?(\d+)%/i,
      /(\d+)%.*?match/i,
      /score:.*?(\d+)%/i,
      /(\d+)\s*%/g,
    ];

    for (const pattern of patterns) {
      const match = analysisText.match(pattern);
      if (match) {
        const score = parseInt(match[1]);
        if (score >= 0 && score <= 100) {
          return score;
        }
      }
    }

    // If no score found, estimate based on content
    if (
      analysisText.toLowerCase().includes("excellent") ||
      analysisText.toLowerCase().includes("strong match")
    ) {
      return 85;
    } else if (
      analysisText.toLowerCase().includes("good") ||
      analysisText.toLowerCase().includes("suitable")
    ) {
      return 75;
    } else if (
      analysisText.toLowerCase().includes("fair") ||
      analysisText.toLowerCase().includes("potential")
    ) {
      return 65;
    } else {
      return 60;
    }
  };

  const parseAnalysisResult = (analysisText) => {
    // Clean and structure the analysis result
    const sections = {
      skills: "",
      experience: "",
      recommendations: "",
      strengths: "",
      weaknesses: "",
      overall: analysisText,
    };

    // Try to extract specific sections if they exist
    const skillsMatch = analysisText.match(
      /<h[2-4]>.*?skills.*?<\/h[2-4]>(.*?)(?=<h[2-4]|$)/is
    );
    if (skillsMatch) sections.skills = skillsMatch[1];

    const expMatch = analysisText.match(
      /<h[2-4]>.*?experience.*?<\/h[2-4]>(.*?)(?=<h[2-4]|$)/is
    );
    if (expMatch) sections.experience = expMatch[1];

    const recMatch = analysisText.match(
      /<h[2-4]>.*?recommendation.*?<\/h[2-4]>(.*?)(?=<h[2-4]|$)/is
    );
    if (recMatch) sections.recommendations = recMatch[1];

    return sections;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file) {
      setError("Please upload your resume");
      return;
    }

    if (!jobDescription.trim()) {
      setError("Please enter the job description");
      return;
    }

    if (jobDescription.trim().length < 20) {
      setError("Job description must be at least 20 characters long");
      return;
    }

    if (apiStatus === "error") {
      setError(
        "Backend server is not available. Please ensure the server is running"
      );
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setResults(null);

      const formData = new FormData();
      formData.append("resume", file);
      formData.append("jobDescription", jobDescription);

      console.log("Sending request to backend...");
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      if (!data.success) {
        throw new Error(data.error || "Analysis failed");
      }

      // Parse and structure the results
      const matchScore = data.matchScore || extractMatchScore(data.result);
      const parsedAnalysis = parseAnalysisResult(data.result);

      setResults({
        matchScore: matchScore,
        analysis: parsedAnalysis,
        rawAnalysis: data.result,
        analyzedAt: data.analyzedAt,
      });

      // Auto-scroll to results after a brief delay
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      console.error("Analysis error:", err);
      let errorMessage = "An error occurred during analysis. Please try again.";

      if (err.message.includes("Failed to fetch")) {
        errorMessage =
          "Cannot connect to the backend server. Please ensure the server is running";
        setApiStatus("error");
      } else {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const getScoreColor = (score) => {
    if (score >= 90) return "from-green-500 to-emerald-600 border-green-400/50";
    if (score >= 80) return "from-blue-500 to-cyan-600 border-blue-400/50";
    if (score >= 70)
      return "from-yellow-500 to-orange-600 border-yellow-400/50";
    return "from-red-500 to-red-600 border-red-400/50";
  };

  const getScoreIcon = (score) => {
    if (score >= 90) return "🎯";
    if (score >= 80) return "👍";
    if (score >= 70) return "👌";
    return "⚠️";
  };

  const getScoreDescription = (score) => {
    if (score >= 90) return "Excellent Match";
    if (score >= 80) return "Strong Match";
    if (score >= 70) return "Good Match";
    if (score >= 60) return "Fair Match";
    return "Needs Improvement";
  };

  const getApiStatusIndicator = () => {
    switch (apiStatus) {
      case "connected":
        return (
          <div className="inline-flex items-center gap-2 text-green-400 text-sm">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span>Server Connected</span>
          </div>
        );
      case "error":
        return (
          <div className="inline-flex items-center gap-2 text-red-400 text-sm">
            <div className="w-2 h-2 bg-red-400 rounded-full"></div>
            <span>Server Disconnected</span>
            <button
              onClick={checkApiHealth}
              className="ml-2 text-blue-400 hover:text-blue-300 underline text-xs"
            >
              Retry
            </button>
          </div>
        );
      default:
        return (
          <div className="inline-flex items-center gap-2 text-yellow-400 text-sm">
            <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
            <span>Checking Connection...</span>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-gray-100">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-900 rounded-full filter blur-3xl opacity-10 animate-float"></div>
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-indigo-900 rounded-full filter blur-3xl opacity-10 animate-float-delay"></div>
        <div className="absolute bottom-1/4 left-1/2 w-80 h-80 bg-cyan-900 rounded-full filter blur-3xl opacity-10 animate-float-delay-2"></div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 relative z-10">
        {/* Header with API Status */}
        <header className="text-center mb-12 transform transition-all duration-500 hover:scale-105">
          <h1 className="text-4xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent animate-gradient font-display">
            ResumeMatch AI
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto font-body mb-4">
            Get instant feedback on how well your resume matches a job
            description with our advanced AI analysis
          </p>
          {/* API Status Indicator */}
          <div className="flex justify-center mb-4">
            {getApiStatusIndicator()}
          </div>
        </header>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="bg-gray-800/60 backdrop-blur-lg rounded-xl p-6 border border-gray-700 hover:border-blue-500 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1">
            {/* File Upload */}
            <div
              onClick={() => fileInputRef.current.click()}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer mb-6 transition-all duration-300 ${
                dragActive
                  ? "border-blue-500 bg-blue-500/20 scale-[1.02] shadow-lg"
                  : "border-gray-600 hover:border-blue-500 bg-blue-500/10"
              }`}
            >
              <div className="text-blue-400 mb-4 flex justify-center animate-bounce">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </div>
              <div className="text-xl font-medium mb-2 font-display">
                {file ? (
                  <span className="text-blue-300">{file.name}</span>
                ) : (
                  "Upload your resume (PDF)"
                )}
              </div>
              <div className="text-gray-400 text-sm font-body">
                {file ? (
                  <div className="space-y-1">
                    <span className="text-green-400">
                      File ready for analysis
                    </span>
                    <div className="text-xs text-gray-500">
                      Size: {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                ) : (
                  "Drag & drop or click to browse files (Max 5MB)"
                )}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf"
                onChange={(e) =>
                  e.target.files[0] && handleFileChange(e.target.files[0])
                }
              />
            </div>

            {/* Job Description */}
            <div className="mb-6">
              <label
                htmlFor="jobDescription"
                className="block font-medium mb-2 text-gray-300 font-display"
              >
                Job Description
                <span className="text-blue-400 ml-1">*</span>
                <span className="text-xs text-gray-500 ml-2">
                  (minimum 20 characters)
                </span>
              </label>
              <textarea
                id="jobDescription"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="w-full min-h-[200px] p-4 rounded-lg border border-gray-700 bg-gray-700/50 text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 focus:outline-none resize-y transition-all duration-300 hover:shadow-md font-body"
                placeholder="Paste the job description here..."
              />
              <div className="flex justify-between items-center text-sm mt-1 transition-all duration-300">
                <div
                  className={`${
                    jobDescription.length < 20 && jobDescription.length > 0
                      ? "text-red-400"
                      : "text-gray-400"
                  }`}
                >
                  {jobDescription.length < 20 &&
                    jobDescription.length > 0 &&
                    "Minimum 20 characters required"}
                </div>
                <div className="font-mono">
                  <span
                    className={
                      jobDescription.length > 0
                        ? "text-blue-400 font-medium"
                        : "text-gray-400"
                    }
                  >
                    {jobDescription.length.toLocaleString()}
                  </span>
                  <span className="text-gray-500"> characters</span>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || apiStatus === "error"}
              className="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2 hover:from-blue-500 hover:to-indigo-600 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed group font-display"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span className="animate-pulse">Analyzing with AI...</span>
                </>
              ) : apiStatus === "error" ? (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>Server Unavailable</span>
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="group-hover:rotate-12 transition-transform duration-300"
                  >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                  </svg>
                  <span>Analyze Resume</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12 animate-pulse">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="absolute inset-2 border-4 border-cyan-400 border-b-transparent rounded-full animate-spin-reverse"></div>
            </div>
            <p className="text-lg font-medium text-blue-300 mb-2 font-display">
              Analyzing your resume with AI...
            </p>
            <p className="text-gray-400 font-body">
              Processing with advanced AI
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Results Section */}
        {results && !isLoading && (
          <div ref={resultsRef} className="space-y-8 animate-fade-in-up">
            {/* Header with Score */}
            <div className="bg-gray-800/60 backdrop-blur-lg rounded-xl p-8 border border-gray-700">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
                <div className="lg:col-span-2">
                  <h2 className="text-3xl font-bold mb-2 font-display bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                    Analysis Complete
                  </h2>
                  <p className="text-gray-400 font-body">
                    Analyzed at: {new Date(results.analyzedAt).toLocaleString()}
                  </p>
                  <p className="text-gray-300 mt-2 font-body">
                    Your resume has been analyzed using advanced AI against
                    the job requirements.
                  </p>
                </div>
                <div className="flex justify-center lg:justify-end">
                  <div className="relative">
                    <div className="absolute -inset-1 bg-gradient-to-r opacity-30 rounded-full blur-md"></div>
                    <div
                      className={`relative inline-flex flex-col items-center gap-2 bg-gradient-to-br px-8 py-6 rounded-full border ${getScoreColor(
                        results.matchScore
                      )}`}
                    >
                      <div className="text-4xl">
                        {getScoreIcon(results.matchScore)}
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-white/80 font-display">
                          Match Score
                        </div>
                        <div className="text-3xl font-bold text-white font-display">
                          {results.matchScore}%
                        </div>
                        <div className="text-xs text-white/70 font-body">
                          {getScoreDescription(results.matchScore)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Analysis Results */}
            <div className="bg-gray-800/70 rounded-xl p-8 border border-gray-700 animate-fade-in-up delay-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-xl text-purple-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                  </svg>
                </div>
                <h3 className="text-2xl font-bold font-display bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                  AI-Powered Analysis
                </h3>
              </div>

              <div className="prose prose-invert max-w-none">
                <div
                  className="text-gray-200 font-body leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: results.rawAnalysis }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 justify-center pt-4">
              <button
                onClick={() => {
                  const element = document.createElement("a");
                  const file = new Blob(
                    [
                      `
# Resume Analysis Report

**Match Score:** ${results.matchScore}%
**Analyzed At:** ${new Date(results.analyzedAt).toLocaleString()}

## Analysis Results

${results.rawAnalysis.replace(/<[^>]*>/g, "")}
                  `,
                    ],
                    { type: "text/plain" }
                  );
                  element.href = URL.createObjectURL(file);
                  element.download = `resume-analysis-${Date.now()}.txt`;
                  document.body.appendChild(element);
                  element.click();
                  document.body.removeChild(element);
                }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-lg transition-all duration-300 hover:shadow-lg hover:-translate-y-1 font-display"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download Report
              </button>
              <button
                onClick={() => {
                  const url = `${window.location.origin}?score=${results.matchScore}`;
                  navigator.clipboard.writeText(url).then(() => {
                    setError("Analysis link copied to clipboard!");
                    setTimeout(() => setError(null), 2000);
                  });
                }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-all duration-300 hover:shadow-lg hover:-translate-y-1 font-display"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                Share Results
              </button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-all duration-300 hover:shadow-lg hover:-translate-y-1 font-display"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 4 1 10 7 10"></polyline>
                  <polyline points="23 20 23 14 17 14"></polyline>
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
                </svg>
                New Analysis
              </button>
            </div>
          </div>
        )}

        {/* Enhanced Error Message */}
        {error && (
          <div className="fixed top-4 right-4 z-50">
            <div className="bg-red-500/90 text-white px-6 py-4 rounded-lg shadow-2xl backdrop-blur-sm border border-red-400 animate-fade-in-right flex items-start gap-3 max-w-md">
              <div className="pt-0.5">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium font-body text-sm leading-relaxed">
                  {error}
                </p>
                <div className="h-1 mt-3 bg-red-400/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-200 rounded-full animate-progress"
                    style={{ animationDuration: "8s" }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Global Styles */}
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800;900&display=swap");

        .font-display {
          font-family: "Playfair Display", serif;
        }
        .font-body {
          font-family: "Inter", sans-serif;
        }
        .font-mono {
          font-family: "JetBrains Mono", monospace;
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(2deg);
          }
        }
        @keyframes float-delay {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-15px) rotate(-3deg);
          }
        }
        @keyframes float-delay-2 {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-25px) rotate(5deg);
          }
        }
        @keyframes gradient {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes progress {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .animate-float {
          animation: float 8s ease-in-out infinite;
        }
        .animate-float-delay {
          animation: float-delay 10s ease-in-out infinite;
        }
        .animate-float-delay-2 {
          animation: float-delay-2 12s ease-in-out infinite;
        }
        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 6s ease infinite;
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.8s ease-out forwards;
        }
        .animate-fade-in-right {
          animation: fadeInRight 0.4s ease-out forwards;
        }
        .animate-progress {
          animation: progress 8s linear forwards;
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        .delay-100 {
          animation-delay: 100ms;
        }
        .delay-200 {
          animation-delay: 200ms;
        }
        .delay-300 {
          animation-delay: 300ms;
        }
        .delay-400 {
          animation-delay: 400ms;
        }
        .delay-500 {
          animation-delay: 500ms;
        }
        .delay-600 {
          animation-delay: 600ms;
        }
        .delay-700 {
          animation-delay: 700ms;
        }

        .animate-spin-reverse {
          animation: spin 1s linear infinite reverse;
        }

        /* Smooth scrolling */
        html {
          scroll-behavior: smooth;
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #1f2937;
        }
        ::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }

        /* Prose styling for AI analysis content */
        .prose h1,
        .prose h2,
        .prose h3,
        .prose h4,
        .prose h5,
        .prose h6 {
          color: #60a5fa;
          font-weight: 600;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }

        .prose p {
          margin-bottom: 1em;
          line-height: 1.7;
        }

        .prose ul,
        .prose ol {
          margin: 1em 0;
          padding-left: 1.5em;
        }

        .prose li {
          margin-bottom: 0.5em;
        }

        .prose strong {
          color: #fbbf24;
          font-weight: 600;
        }

        .prose em {
          color: #a78bfa;
          font-style: italic;
        }

        .prose blockquote {
          border-left: 4px solid #3b82f6;
          padding-left: 1em;
          margin: 1em 0;
          font-style: italic;
          color: #9ca3af;
        }

        .prose code {
          background-color: #374151;
          padding: 0.2em 0.4em;
          border-radius: 0.25em;
          font-size: 0.875em;
          color: #60a5fa;
        }

        .prose pre {
          background-color: #1f2937;
          padding: 1em;
          border-radius: 0.5em;
          overflow-x: auto;
          margin: 1em 0;
        }

        .prose table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
        }

        .prose th,
        .prose td {
          border: 1px solid #374151;
          padding: 0.75em;
          text-align: left;
        }

        .prose th {
          background-color: #374151;
          font-weight: 600;
          color: #f3f4f6;
        }

        .prose hr {
          border: none;
          border-top: 1px solid #374151;
          margin: 2em 0;
        }
      `}</style>
    </div>
  );
}