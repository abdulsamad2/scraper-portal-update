'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, Save, Trash2, Plus, Minus, Settings, 
  AlertTriangle, Info, CheckCircle, X, Target, Filter, TrendingUp 
} from 'lucide-react';
import { 
  getExclusionRules, 
  saveExclusionRules, 
  getEventSectionsAndRows, 
  getPricingStatistics,
  SectionRowExclusion,
  OutlierExclusion,
  ExclusionRulesData 
} from '@/actions/exclusionActions';
import { getEventById } from '@/actions/eventActions';

interface ExclusionPageProps {
  eventId: string;
  eventName: string;
}

interface SectionData {
  section: string;
  rows: string[];
  totalListings: number;
  avgPrice: number;
}

interface PricingStats {
  totalListings: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  baselineAverage: number;
  lowestPrices: number[];
}

export default function ExclusionManagementPage({ eventId, eventName }: ExclusionPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [pricingStats, setPricingStats] = useState<PricingStats | null>(null);
  
  // Exclusion rules state
  const [sectionRowExclusions, setSectionRowExclusions] = useState<SectionRowExclusion[]>([]);
  const [outlierExclusion, setOutlierExclusion] = useState<OutlierExclusion>({
    enabled: false,
    percentageBelowAverage: undefined,
    baselineListingsCount: undefined
  });
  
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rulesResult, sectionsResult, statsResult] = await Promise.all([
        getExclusionRules(eventId),
        getEventSectionsAndRows(eventId),
        getPricingStatistics(eventId)
      ]);

      if (sectionsResult.success && sectionsResult.data) {
        setSections(sectionsResult.data);
      }

      if (statsResult.success && statsResult.data) {
        setPricingStats(statsResult.data);
      }

      if (rulesResult.success && rulesResult.data) {
        const data = Array.isArray(rulesResult.data) ? rulesResult.data[0] : rulesResult.data;
        setSectionRowExclusions(data?.sectionRowExclusions || []);
        setOutlierExclusion(data?.outlierExclusion || {
          enabled: false,
          percentageBelowAverage: undefined,
          baselineListingsCount: undefined
        });
      }
    } catch (error) {
      console.error('Error loading data:', error);
      showNotification('error', 'Failed to load exclusion data');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleSave = async () => {
    // Validate outlier exclusion configuration
    if (outlierExclusion.enabled) {
      if (!outlierExclusion.baselineListingsCount || !outlierExclusion.percentageBelowAverage) {
        showNotification('error', 'Please configure both baseline count and threshold percentage for outlier detection');
        return;
      }
    }

    setSaving(true);
    try {
      const rulesData: ExclusionRulesData = {
        eventId,
        eventName,
        sectionRowExclusions,
        outlierExclusion,
        isActive: true
      };

      const result = await saveExclusionRules(rulesData);
      
      if (result.success) {
        showNotification('success', 'Exclusion rules saved successfully');
      } else {
        showNotification('error', result.error || 'Failed to save exclusion rules');
      }
    } catch (error) {
      console.error('Error saving rules:', error);
      showNotification('error', 'Failed to save exclusion rules');
    } finally {
      setSaving(false);
    }
  };

  const addSectionExclusion = () => {
    setSectionRowExclusions([
      ...sectionRowExclusions,
      { section: '', excludeEntireSection: false, excludedRows: [] }
    ]);
  };

  const removeSectionExclusion = (index: number) => {
    setSectionRowExclusions(sectionRowExclusions.filter((_, i) => i !== index));
  };

  const updateSectionExclusion = (index: number, updates: Partial<SectionRowExclusion>) => {
    setSectionRowExclusions(sectionRowExclusions.map((exclusion, i) => 
      i === index ? { ...exclusion, ...updates } : exclusion
    ));
  };

  const toggleRowExclusion = (sectionIndex: number, row: string) => {
    const exclusion = sectionRowExclusions[sectionIndex];
    const isExcluded = exclusion.excludedRows.includes(row);
    
    const newExcludedRows = isExcluded
      ? exclusion.excludedRows.filter(r => r !== row)
      : [...exclusion.excludedRows, row];
    
    updateSectionExclusion(sectionIndex, { excludedRows: newExcludedRows });
  };

  const calculateOutlierThreshold = () => {
    if (!pricingStats || !outlierExclusion.percentageBelowAverage) return 0;
    return pricingStats.baselineAverage * (1 - outlierExclusion.percentageBelowAverage / 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-6xl mx-auto p-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">Loading exclusion settings...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link 
            href={`/dashboard/events/${eventId}`}
            className="inline-flex items-center text-slate-600 hover:text-blue-600 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Event
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            <Save size={16} />
            <span>{saving ? 'Saving...' : 'Save Rules'}</span>
          </button>
        </div>

        {/* Title Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden backdrop-blur-sm">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-8 text-white relative overflow-hidden">
            <div className="relative">
              <h1 className="text-4xl font-bold mb-3 text-white drop-shadow-sm">Exclusion Management</h1>
              <p className="text-purple-100 font-medium">Configure seat and price exclusions for: <strong>{eventName}</strong></p>
            </div>
          </div>
        </div>

        {/* Notification */}
        {notification && (
          <div className={`p-4 rounded-2xl shadow-sm border flex items-center justify-between ${
            notification.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' :
            notification.type === 'error' ? 'bg-red-50 text-red-800 border-red-200' :
            'bg-blue-50 text-blue-800 border-blue-200'
          }`}>
            <div className="flex items-center space-x-2">
              {notification.type === 'success' && <CheckCircle size={20} />}
              {notification.type === 'error' && <AlertTriangle size={20} />}
              {notification.type === 'info' && <Info size={20} />}
              <span className="font-medium">{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-current hover:opacity-70 transition-opacity"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="space-y-6">
          {/* Outlier Price Exclusions - Top Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 hover:shadow-2xl transition-all duration-300">
            <div className="p-8 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-3">
                <TrendingUp className="text-orange-600" size={24} />
                Outlier Price Exclusions
              </h2>
              <p className="text-slate-600 font-medium">Automatically exclude listings priced below market level</p>
            </div>
            
            <div className="p-8">
              <div className="flex items-center space-x-3 bg-orange-50 p-4 rounded-xl border border-orange-200 mb-8">
                <input
                  type="checkbox"
                  checked={outlierExclusion.enabled}
                  onChange={(e) => setOutlierExclusion({ ...outlierExclusion, enabled: e.target.checked })}
                  className="w-5 h-5 text-orange-600 border-slate-300 rounded focus:ring-orange-500"
                  id="outlier-enabled"
                />
                <label htmlFor="outlier-enabled" className="text-slate-700 font-semibold cursor-pointer">
                  Enable outlier price exclusions
                </label>
              </div>

              {outlierExclusion.enabled && (
                <div className="space-y-8">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                      Baseline Count: <span className="text-orange-600">{outlierExclusion.baselineListingsCount ? `${outlierExclusion.baselineListingsCount} lowest listings` : 'Not set'}</span>
                    </label>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={outlierExclusion.baselineListingsCount || 3}
                        onChange={(e) => setOutlierExclusion({ 
                          ...outlierExclusion, 
                          baselineListingsCount: parseInt(e.target.value) 
                        })}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
                        <span>1</span>
                        <span>10</span>
                      </div>
                    </div>
                    {!outlierExclusion.baselineListingsCount && (
                      <p className="text-red-600 text-xs mt-2 font-semibold">Please select baseline count</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                      Exclusion Threshold: <span className="text-blue-600">{outlierExclusion.percentageBelowAverage ? `${outlierExclusion.percentageBelowAverage}%` : 'Not set'}</span> below baseline
                    </label>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <input
                        type="range"
                        min="5"
                        max="30"
                        step="0.5"
                        value={outlierExclusion.percentageBelowAverage || 5}
                        onChange={(e) => setOutlierExclusion({ 
                          ...outlierExclusion, 
                          percentageBelowAverage: parseFloat(e.target.value) 
                        })}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
                        <span>5%</span>
                        <span>30%</span>
                      </div>
                    </div>
                    {!outlierExclusion.percentageBelowAverage && (
                      <p className="text-red-600 text-xs mt-2 font-semibold">Please select threshold percentage</p>
                    )}
                  </div>

                  {pricingStats && outlierExclusion.percentageBelowAverage && outlierExclusion.baselineListingsCount && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6 shadow-sm">
                      <h3 className="font-bold text-blue-800 mb-4 flex items-center text-lg">
                        <Target className="mr-3" size={20} />
                        Current Pricing Analysis
                      </h3>
                      <div className="grid grid-cols-2 gap-6 text-sm">
                        <div className="space-y-2">
                          <span className="text-blue-600 font-bold text-xs uppercase tracking-wider">Total Listings:</span>
                          <p className="text-blue-900 font-bold text-lg">{pricingStats.totalListings}</p>
                        </div>
                        <div className="space-y-2">
                          <span className="text-blue-600 font-bold text-xs uppercase tracking-wider">Average Price:</span>
                          <p className="text-blue-900 font-bold text-lg">${pricingStats.avgPrice}</p>
                        </div>
                        <div className="space-y-2">
                          <span className="text-blue-600 font-bold text-xs uppercase tracking-wider">Baseline Average:</span>
                          <p className="text-blue-900 font-bold text-lg">${pricingStats.baselineAverage}</p>
                        </div>
                        <div className="space-y-2">
                          <span className="text-blue-600 font-bold text-xs uppercase tracking-wider">Exclusion Threshold:</span>
                          <p className="text-blue-900 font-bold text-lg">${calculateOutlierThreshold().toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Section & Row Exclusions - Second Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 hover:shadow-2xl transition-all duration-300">
            <div className="p-8 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-3">
                <Filter className="text-blue-600" size={24} />
                Section & Row Exclusions
              </h2>
              <p className="text-slate-600 font-medium">Exclude entire sections or specific rows from CSV generation</p>
            </div>
            
            <div className="p-8">
              <div className="space-y-6 mb-8">
                {sectionRowExclusions.map((exclusion, index) => (
                  <div key={index} className="border border-slate-200 rounded-2xl p-6 bg-gradient-to-r from-slate-50 to-slate-50 hover:from-slate-100 hover:to-slate-100 transition-all duration-200">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold text-slate-800 text-lg">Exclusion Rule {index + 1}</h3>
                      <button
                        onClick={() => removeSectionExclusion(index)}
                        className="text-red-600 hover:text-red-800 transition-colors p-2 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">Section</label>
                        <select
                          value={exclusion.section}
                          onChange={(e) => updateSectionExclusion(index, { 
                            section: e.target.value,
                            excludedRows: [] // Reset rows when section changes
                          })}
                          className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm font-medium"
                        >
                          <option value="">Select Section</option>
                          {sections.map(section => (
                            <option key={section.section} value={section.section}>
                              {section.section} ({section.totalListings} listings)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center space-x-3 bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <input
                          type="checkbox"
                          checked={exclusion.excludeEntireSection}
                          onChange={(e) => updateSectionExclusion(index, { 
                            excludeEntireSection: e.target.checked,
                            excludedRows: e.target.checked ? [] : exclusion.excludedRows
                          })}
                          className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <label className="text-sm font-bold text-slate-800">
                          Exclude entire section
                        </label>
                      </div>

                      {!exclusion.excludeEntireSection && exclusion.section && (
                        <div>
                          <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            Excluded Rows ({exclusion.excludedRows.length} selected)
                          </label>
                          <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto bg-slate-50 p-4 rounded-xl border border-slate-200">
                            {sections.find(s => s.section === exclusion.section)?.rows.map(row => (
                              <button
                                key={row}
                                onClick={() => toggleRowExclusion(index, row)}
                                className={`px-4 py-2 text-sm rounded-lg border-2 transition-all font-semibold ${
                                  exclusion.excludedRows.includes(row)
                                    ? 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
                                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 hover:border-slate-400'
                                }`}
                              >
                                {row}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <button
                onClick={addSectionExclusion}
                className="flex items-center justify-center space-x-3 w-full py-4 border-2 border-dashed border-slate-300 rounded-2xl text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 font-semibold"
              >
                <Plus size={24} />
                <span>Add Section Exclusion</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}