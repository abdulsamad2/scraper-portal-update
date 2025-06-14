"use client";
import React, { useState } from "react";
import { createEvent } from "@/actions/eventActions";
import {
  Calendar,
  Globe,
  Clock,
  MapPin,
  Tag,
  Hash,
  Ticket,
  Save,
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Loader,
} from "lucide-react";

const NewScraper = ({ onCancel, onSuccess }) => {
  const [formData, setFormData] = useState({
    URL: "",
    Event_ID: "",
    Event_Name: "",
    Event_DateTime: "",
    Venue: "",
    Zone: "General",
    Available_Seats: 0,
    Skip_Scraping: true,
    inHandDate: "",
    mapping_id: "",
    Percentage_Increase_ListCost: 0,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [validationState, setValidationState] = useState({
    URL: true,
    Event_ID: true,
    Event_Name: true,
    Event_DateTime: true,
    Venue: true,
    Zone: true,
    inHandDate: true,
    mapping_id: true,
    Percentage_Increase_ListCost: true,
  });
  const [touchedFields, setTouchedFields] = useState({
    URL: false,
    Event_ID: false,
    Event_Name: false,
    Event_DateTime: false,
    Venue: false,
    Zone: false,
    inHandDate: false,
    mapping_id: false,
    Percentage_Increase_ListCost: false,
  });

  // Helper function to extract Event ID from URL
  const extractEventIdFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      if (
        parsed.hostname.includes("ticketmaster.com") &&
        parsed.pathname.includes("/event/")
      ) {
        // Try to extract event ID from pathname
        const pathParts = parsed.pathname.split("/");
        const eventIdIndex =
          pathParts.findIndex((part) => part === "event") + 1;
        if (eventIdIndex < pathParts.length) {
          return pathParts[eventIdIndex];
        }
      }
      return "";
    } catch {
      return "";
    }
  };

  const validateUrl = (url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes("ticketmaster.com") &&
        parsed.pathname.includes("/event/")
      );
    } catch {
      return false;
    }
  };

  const validateForm = () => {
    const validation = {
      URL: validateUrl(formData.URL),
      Event_ID: formData.Event_ID.length > 0,
      Event_Name: formData.Event_Name.length >= 3,
      Event_DateTime: Boolean(formData.Event_DateTime),
      Venue: formData.Venue.length > 0,
      Zone: formData.Zone.length > 0,
      inHandDate: Boolean(formData.inHandDate),
      mapping_id: formData.mapping_id.length > 0,
      Percentage_Increase_ListCost: formData.Percentage_Increase_ListCost >= 0,
    };

    setValidationState(validation);
    // Mark all fields as touched when validating the entire form
    setTouchedFields({
      URL: true,
      Event_ID: true,
      Event_Name: true,
      Event_DateTime: true,
      Venue: true,
      Zone: true,
      inHandDate: true,
      mapping_id: true,
      Percentage_Increase_ListCost: true,
    });
    return Object.values(validation).every(Boolean);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    // Special handling for URL changes - try to extract event ID
    if (name === "URL" && validateUrl(value) && !formData.Event_ID) {
      const extractedId = extractEventIdFromUrl(value);
      if (extractedId) {
        setFormData((prev) => ({
          ...prev,
          [name]: value,
          Event_ID: extractedId,
        }));
      } else {
        setFormData((prev) => ({
          ...prev,
          [name]: value,
        }));
      }
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }

    setError("");
    setTouchedFields((prev) => ({
      ...prev,
      [name]: true,
    }));

    // Live validation for the changed field
    let isValid = true;
    switch (name) {
      case "URL":
        isValid = validateUrl(value);
        break;
      case "Event_ID":
      case "Venue":
      case "Zone":
        isValid = value.length > 0;
        break;
      case "Event_Name":
        isValid = value.length >= 3;
        break;
      case "Event_DateTime":
      case "inHandDate":
        isValid = Boolean(value);
        break;
      default:
        break;
    }

    setValidationState((prev) => ({
      ...prev,
      [name]: isValid,
    }));
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouchedFields((prev) => ({
      ...prev,
      [name]: true,
    }));
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      setError("Please fill in all required fields correctly");
      const firstInvalidField = Object.keys(validationState).find(
        (key) => !validationState[key]
      );
      if (firstInvalidField) {
        document.getElementById(firstInvalidField)?.focus();
      }
      return;
    }

    setLoading(true);
    setError("");

    try {
      const eventData = {
        URL: formData.URL,
        Event_ID: formData.Event_ID,
        Event_Name: formData.Event_Name,
        Event_DateTime: formData.Event_DateTime,
        Venue: formData.Venue,
        Zone: formData.Zone,
        Available_Seats: formData.Available_Seats,
        Skip_Scraping: formData.Skip_Scraping,
        inHandDate: formData.inHandDate,
        mapping_id: formData.mapping_id,
        priceIncreasePercentage: formData.Percentage_Increase_ListCost,
      };

      const result = await createEvent(eventData);

      if (result.error) {
        throw new Error(result.error);
      }

      setSuccess("Event created successfully!");

      // Clear form and reset states
      setTimeout(() => {
        onSuccess?.(result);
      }, 1500);
    } catch (err) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={loading}
            title="Back to events"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800">
              Add New Event
            </h1>
            <p className="text-sm text-gray-500">
              Create a new event to track ticket availability
            </p>
          </div>
        </div>
      </div>

      {/* Main Form Card */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Status Messages */}
        {error && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* URL Field */}
            <div className="md:col-span-2">
              <label
                htmlFor="URL"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event URL <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Globe className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="URL"
                  name="URL"
                  type="url"
                  value={formData.URL}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="https://www.ticketmaster.com/event/..."
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.URL && touchedFields.URL
                      ? "border-red-500 bg-red-50"
                      : validationState.URL && formData.URL
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.URL &&
                  (validationState.URL && formData.URL ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.URL ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.URL && touchedFields.URL && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please enter a valid Ticketmaster event URL
                </p>
              )}
            </div>

            {/* Event ID Field */}
            <div>
              <label
                htmlFor="Event_ID"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event ID <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Hash className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Event_ID"
                  name="Event_ID"
                  type="text"
                  value={formData.Event_ID}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Enter event ID"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Event_ID && touchedFields.Event_ID
                      ? "border-red-500 bg-red-50"
                      : validationState.Event_ID && formData.Event_ID
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Event_ID &&
                  (validationState.Event_ID && formData.Event_ID ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Event_ID ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Event_ID && touchedFields.Event_ID && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please enter a valid event ID
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                This ID will be extracted automatically if present in the URL
              </p>
            </div>

            {/* Event Name Field */}
            <div>
              <label
                htmlFor="Event_Name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Event_Name"
                  name="Event_Name"
                  type="text"
                  value={formData.Event_Name}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Event Name"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Event_Name && touchedFields.Event_Name
                      ? "border-red-500 bg-red-50"
                      : validationState.Event_Name && formData.Event_Name
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Event_Name &&
                  (validationState.Event_Name && formData.Event_Name ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Event_Name ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Event_Name && touchedFields.Event_Name && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Name must be at least 3 characters long
                </p>
              )}
            </div>

            {/* Event Date/Time Field */}
            <div>
              <label
                htmlFor="Event_DateTime"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event Date & Time <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Event_DateTime"
                  name="Event_DateTime"
                  type="datetime-local"
                  value={formData.Event_DateTime}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Event_DateTime &&
                    touchedFields.Event_DateTime
                      ? "border-red-500 bg-red-50"
                      : validationState.Event_DateTime &&
                        formData.Event_DateTime
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Event_DateTime &&
                  (validationState.Event_DateTime && formData.Event_DateTime ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Event_DateTime ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Event_DateTime &&
                touchedFields.Event_DateTime && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Please select an event date and time
                  </p>
                )}
            </div>

            {/* In-Hand Date Field */}
            <div>
              <label
                htmlFor="inHandDate"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                In-Hand Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="inHandDate"
                  name="inHandDate"
                  type="date"
                  value={formData.inHandDate}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.inHandDate && touchedFields.inHandDate
                      ? "border-red-500 bg-red-50"
                      : validationState.inHandDate && formData.inHandDate
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.inHandDate &&
                  (validationState.inHandDate && formData.inHandDate ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.inHandDate ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.inHandDate && touchedFields.inHandDate && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please select an in-hand date
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                When tickets will be available/in hand
              </p>
            </div>

            {/* Venue Field */}
            <div>
              <label
                htmlFor="Venue"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Venue <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MapPin className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Venue"
                  name="Venue"
                  type="text"
                  value={formData.Venue}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Enter venue name"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Venue && touchedFields.Venue
                      ? "border-red-500 bg-red-50"
                      : validationState.Venue && formData.Venue
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Venue &&
                  (validationState.Venue && formData.Venue ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Venue ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Venue && touchedFields.Venue && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please enter the venue name
                </p>
              )}
            </div>

            {/* Zone Field */}
            <div>
              <label
                htmlFor="Zone"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Zone <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Ticket className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Zone"
                  name="Zone"
                  type="text"
                  value={formData.Zone}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Enter zone"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Zone && touchedFields.Zone
                      ? "border-red-500 bg-red-50"
                      : validationState.Zone && formData.Zone
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Zone &&
                  (validationState.Zone && formData.Zone ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Zone ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Zone && touchedFields.Zone && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please enter a zone
                </p>
              )}
            </div>

            {/* Available Seats Field */}
            <div>
              <label
                htmlFor="Available_Seats"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Available Seats
              </label>
              <div className="relative">
                <input
                  id="Available_Seats"
                  name="Available_Seats"
                  type="number"
                  min="0"
                  value={formData.Available_Seats}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  disabled={loading}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Initial number of available seats (if known)
              </p>
            </div>

            {/* Skip Scraping Field */}
            <div className="flex items-center">
              <input
                id="Skip_Scraping"
                name="Skip_Scraping"
                type="checkbox"
                checked={formData.Skip_Scraping}
                onChange={handleCheckboxChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={loading}
              />
              <label
                htmlFor="Skip_Scraping"
                className="ml-2 block text-sm text-gray-700"
              >
                Initially Paused (Skip Scraping)
              </label>
            </div>

            {/* Event Mapping ID Field */}
            <div>
              <label
                htmlFor="mapping_id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Event Mapping ID <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Hash className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="mapping_id"
                  name="mapping_id"
                  type="text"
                  value={formData.mapping_id}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Enter event mapping ID"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.mapping_id && touchedFields.mapping_id
                      ? "border-red-500 bg-red-50"
                      : validationState.mapping_id && formData.mapping_id
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.mapping_id &&
                  (validationState.mapping_id && formData.mapping_id ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.mapping_id ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.mapping_id && touchedFields.mapping_id && (
                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please enter a valid event mapping ID
                </p>
              )}
            </div>

            {/* Percentage Increase List Cost Field */}
            <div>
              <label
                htmlFor="Percentage_Increase_ListCost"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Percentage Increase List Cost{" "}
                <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="Percentage_Increase_ListCost"
                  name="Percentage_Increase_ListCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.Percentage_Increase_ListCost}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  placeholder="Enter percentage increase"
                  className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                    !validationState.Percentage_Increase_ListCost &&
                    touchedFields.Percentage_Increase_ListCost
                      ? "border-red-500 bg-red-50"
                      : validationState.Percentage_Increase_ListCost &&
                        formData.Percentage_Increase_ListCost
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300"
                  }`}
                  disabled={loading}
                />
                {touchedFields.Percentage_Increase_ListCost &&
                  (validationState.Percentage_Increase_ListCost &&
                  formData.Percentage_Increase_ListCost ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ) : !validationState.Percentage_Increase_ListCost ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  ) : null)}
              </div>
              {!validationState.Percentage_Increase_ListCost &&
                touchedFields.Percentage_Increase_ListCost && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Please enter a valid percentage (0 or greater)
                  </p>
                )}
              <p className="mt-1 text-xs text-gray-500">
                Percentage to increase the list cost by
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-4 pt-4 border-t mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                loading ? "opacity-70 cursor-not-allowed" : ""
              }`}
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Start Tracking
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewScraper;
