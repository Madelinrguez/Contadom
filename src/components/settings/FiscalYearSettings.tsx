import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { supabase } from '../../lib/supabase';
import { 
  Calendar, 
  Check, 
  ChevronDown, 
  ChevronRight, 
  Lock, 
  Unlock, 
  Plus,
  XCircle,
  AlertCircle,
  CalendarIcon,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronUp
} from 'lucide-react';
import { 
  MonthlyPeriod,
  PeriodForm,
  createFiscalYear,
  fetchFiscalYears,
  closeFiscalYear,
  reopenFiscalYear,
  toggleFiscalYearActive,
  closeMonthlyPeriod,
  toggleMonthlyPeriodActive,
  initializeMonthlyPeriodsForFiscalYear
} from '../../services/accountingPeriodService';
import Modal from '../ui/Modal';
import Decimal from 'decimal.js';

// Agregar interfaz para extender MonthlyPeriod con fiscal_year
interface EnhancedMonthlyPeriod extends MonthlyPeriod {
  fiscal_year?: {
    name: string;
    is_closed: boolean;
    is_active: boolean;
  };
}

// Definir nuestra interfaz local para FiscalYear
interface LocalFiscalYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  is_active: boolean;
  fiscal_year_type: "calendar" | "custom";
  monthly_periods?: MonthlyPeriod[]; // Lista de períodos mensuales
  has_monthly_periods?: boolean; // Indicador de si ya tiene períodos
  monthly_periods_count?: number;
}

export function FiscalYearSettings() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [fiscalYears, setFiscalYears] = useState<LocalFiscalYear[]>([]);
  const [expandedYears, setExpandedYears] = useState<string[]>([]);
  const [processingYearId, setProcessingYearId] = useState<string | null>(null);
  const [processingPeriodId, setProcessingPeriodId] = useState<string | null>(null);
  const [allMonthlyPeriods, setAllMonthlyPeriods] = useState<EnhancedMonthlyPeriod[]>([]);
  
  // Modal para crear nuevo año fiscal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState<PeriodForm>({
    name: '',
    start_date: '',
    end_date: '',
    notes: '',
    fiscal_year_type: 'calendar'
  });

  // Modal para reapertura de año fiscal
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
  const [selectedYearForReopen, setSelectedYearForReopen] = useState<LocalFiscalYear | null>(null);

  // Estadísticas de períodos
  const [periodStats, setPeriodStats] = useState<Record<string, { count: number, balance: Decimal }>>({});
  
  useEffect(() => {
    getCurrentUser();
    fetchData();
  }, []);

  async function getCurrentUser() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  }

  async function fetchData() {
    setLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      setUser(user?.user);
      
      // Obtener años fiscales con información de períodos mensuales
      const { data: fiscalYearsData, error } = await supabase
        .from('accounting_periods')
        .select(`
          *,
          monthly_periods:monthly_accounting_periods(count)
        `)
        .order('start_date', { ascending: false });
        
      if (error) throw error;
      
      // Procesar los datos para determinar si tienen períodos inicializados
      const processedData = fiscalYearsData.map(year => ({
        ...year,
        has_monthly_periods: year.monthly_periods && year.monthly_periods[0]?.count > 0,
        monthly_periods_count: year.monthly_periods ? year.monthly_periods[0]?.count : 0
      }));
      
      setFiscalYears(processedData);
      
      // Expandir automáticamente solo el año fiscal que tiene el período del mes actual
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1; // 1-12
      
      // Obtener períodos mensuales para todos los años
      const { data: allMonthlyPeriods, error: monthlyError } = await supabase
        .from('monthly_accounting_periods')
        .select('*, fiscal_year:fiscal_year_id(name, is_closed, is_active)')
        .order('start_date', { ascending: false });
        
      if (monthlyError) throw monthlyError;
      
      // Encontrar el período actual y su año fiscal
      const currentPeriod = allMonthlyPeriods?.find(period => {
        return period.year === currentYear && period.month === currentMonth;
      });
      
      if (currentPeriod) {
        // Expandir el año fiscal que contiene el período actual
        setExpandedYears([currentPeriod.fiscal_year_id]);
      } else if (processedData.length > 0) {
        // Si no hay un período actual, expandir el año fiscal más reciente
        setExpandedYears([processedData[0].id]);
      }
      
      // Cargar estadísticas para los períodos
      await loadPeriodStats(processedData);
      
      // Obtener todos los períodos mensuales (para la vista plana)
      setAllMonthlyPeriods(allMonthlyPeriods || []);
      
    } catch (error) {
      console.error('Error al cargar años fiscales:', error);
      toast.error('Error al cargar los años fiscales');
    } finally {
      setLoading(false);
    }
  }

  // Función para cargar estadísticas de períodos (número de asientos contables)
  async function loadPeriodStats(years: LocalFiscalYear[]) {
    try {
      // Obtener todos los períodos mensuales
      const { data: allPeriods, error: periodsError } = await supabase
        .from('monthly_accounting_periods')
        .select('id')
        .order('start_date', { ascending: false });
        
      if (periodsError) throw periodsError;
      
      const stats: Record<string, { count: number, balance: Decimal }> = {};
      
      // Inicializar todos los períodos con cero asientos
      if (allPeriods && allPeriods.length > 0) {
        allPeriods.forEach(period => {
          stats[period.id] = { count: 0, balance: new Decimal(0) };
        });
        
        // Obtener los datos de conteo
        const { data, error } = await supabase
          .from('journal_entries')
          .select('monthly_period_id');
          
        if (!error && data) {
          // Contar manualmente las entradas por período
          data.forEach(entry => {
            if (entry.monthly_period_id && stats[entry.monthly_period_id]) {
              stats[entry.monthly_period_id].count += 1;
            }
          });
        }
      }
      
      setPeriodStats(stats);
    } catch (error) {
      console.error('Error cargando estadísticas de períodos:', error);
      setPeriodStats({});
    }
  }

  const toggleYearExpansion = (yearId: string) => {
    setExpandedYears(prev => 
      prev.includes(yearId) 
        ? prev.filter(id => id !== yearId) 
        : [...prev, yearId]
    );
  };

  const handleCloseYear = async (year: LocalFiscalYear) => {
    if (!user?.id) {
      toast.error('Debes iniciar sesión para realizar esta acción');
      return;
    }
    
    try {
      setProcessingYearId(year.id);
      
      // Confirmar con el usuario
      if (!window.confirm(`¿Estás seguro de cerrar el año fiscal ${year.name} y todos sus períodos mensuales? Esta acción cerrará permanentemente todos los períodos mensuales que no estén cerrados.`)) {
        return;
      }
      
      // Cerrar año fiscal
      const { success, error } = await closeFiscalYear(year.id, user.id);
      
      if (!success) {
        throw new Error(error || 'Error al cerrar el año fiscal');
      }
      
      toast.success(`Año fiscal ${year.name} cerrado correctamente junto con sus períodos mensuales`);
      
      // Refrescar datos
      fetchData();
      
    } catch (error: any) {
      console.error('Error al cerrar año fiscal:', error);
      toast.error(`Error: ${error.message || 'No se pudo cerrar el año fiscal'}`);
    } finally {
      setProcessingYearId(null);
    }
  };

  const handleToggleYearActive = async (year: LocalFiscalYear, activate: boolean) => {
    if (!user?.id) {
      toast.error('Debes iniciar sesión para realizar esta acción');
      return;
    }
    
    try {
      setProcessingYearId(year.id);
      
      // Confirmar con el usuario
      if (!window.confirm(`¿Estás seguro de ${activate ? 'activar' : 'desactivar'} el año fiscal ${year.name} y ${activate ? 'el período del mes actual' : 'todos sus períodos mensuales'}?`)) {
        return;
      }
      
      // Activar/desactivar año fiscal
      const { success, error } = await toggleFiscalYearActive(year.id, activate, user.id);
      
      if (!success) {
        throw new Error(error || `Error al ${activate ? 'activar' : 'desactivar'} el año fiscal`);
      }
      
      toast.success(`Año fiscal ${year.name} ${activate ? 'activado' : 'desactivado'} correctamente junto con ${activate ? 'el período del mes actual' : 'sus períodos mensuales'}`);
      
      // Refrescar datos
      await fetchData();
      
      // Si se activó, verificar que solo se expande el período actual
      if (activate) {
        // Sólo asegurarse de que este año fiscal esté expandido
        if (!expandedYears.includes(year.id)) {
          setExpandedYears([...expandedYears, year.id]);
        }
      }
      
    } catch (error: any) {
      console.error(`Error al ${activate ? 'activar' : 'desactivar'} año fiscal:`, error);
      toast.error(`Error: ${error.message || `No se pudo ${activate ? 'activar' : 'desactivar'} el año fiscal`}`);
    } finally {
      setProcessingYearId(null);
    }
  };

  // Función para inicializar períodos mensuales de un año fiscal
  const handleInitializeMonthlyPeriods = async (fiscalYearId: string) => {
    if (!user?.id) {
      toast.error('Debes iniciar sesión para realizar esta acción');
      return;
    }
    
    try {
      setProcessingYearId(fiscalYearId);
      
      // Confirmar con el usuario
      if (!window.confirm('¿Estás seguro de inicializar los períodos mensuales para este año fiscal? Esta acción creará todos los períodos mensuales correspondientes.')) {
        setProcessingYearId(null);
        return;
      }
      
      const { success, error } = await initializeMonthlyPeriodsForFiscalYear(fiscalYearId, user.id);
      
      if (!success) throw new Error(error);
      
      toast.success('Períodos mensuales inicializados correctamente');
      
      // Refrescar la data completa
      await fetchData();
      
      // Expandir el año que acabamos de inicializar si no está expandido
      if (!expandedYears.includes(fiscalYearId)) {
        setExpandedYears(prev => [...prev, fiscalYearId]);
      }
    } catch (error: any) {
      console.error('Error al inicializar períodos mensuales:', error);
      toast.error(`Error: ${error.message || 'No se pudieron inicializar los períodos mensuales'}`);
    } finally {
      setProcessingYearId(null);
    }
  };

  // Función para cerrar un período mensual individual
  const handleClosePeriod = async (period: MonthlyPeriod) => {
    if (!user?.id || !period.id) {
      toast.error('Debes iniciar sesión para realizar esta acción');
      return;
    }
    
    try {
      setProcessingPeriodId(period.id);
      
      // Confirmar con el usuario
      if (!window.confirm(`¿Estás seguro de cerrar el período mensual ${period.name}? Esta acción impedirá registrar nuevos asientos contables en este período.`)) {
        return;
      }
      
      // Cerrar período mensual
      const { success, error } = await closeMonthlyPeriod(period.id, user.id);
      
      if (!success) {
        throw new Error(error || 'Error al cerrar el período mensual');
      }
      
      toast.success(`Período ${period.name} cerrado correctamente`);
      
      // Refrescar datos
      fetchData();
      
    } catch (error: any) {
      console.error('Error al cerrar período mensual:', error);
      toast.error(`Error: ${error.message || 'No se pudo cerrar el período mensual'}`);
    } finally {
      setProcessingPeriodId(null);
    }
  };

  // Función para activar/desactivar un período mensual individual
  const handleTogglePeriodActive = async (period: MonthlyPeriod, activate: boolean) => {
    if (!user?.id || !period.id) {
      toast.error('Debes iniciar sesión para realizar esta acción');
      return;
    }
    
    try {
      setProcessingPeriodId(period.id);
      
      // Verificar si el año fiscal está activo cuando intentamos activar un período
      if (activate) {
        // Buscar el año fiscal correspondiente al período
        const fiscalYear = fiscalYears.find(year => year.id === period.fiscal_year_id);
        
        if (!fiscalYear || !fiscalYear.is_active) {
          toast.error('No se puede activar un período mensual cuando su año fiscal está inactivo. Activa primero el año fiscal.');
          setProcessingPeriodId(null);
          return;
        }
      }
      
      // Confirmar con el usuario
      if (!window.confirm(`¿Estás seguro de ${activate ? 'activar' : 'desactivar'} el período mensual ${period.name}?`)) {
        setProcessingPeriodId(null);
        return;
      }
      
      // Activar/desactivar período mensual
      const { success, error } = await toggleMonthlyPeriodActive(period.id, activate, user.id);
      
      if (!success) {
        throw new Error(error || `Error al ${activate ? 'activar' : 'desactivar'} el período mensual`);
      }
      
      toast.success(`Período ${period.name} ${activate ? 'activado' : 'desactivado'} correctamente`);
      
      // Refrescar datos
      fetchData();
      
    } catch (error: any) {
      console.error(`Error al ${activate ? 'activar' : 'desactivar'} período mensual:`, error);
      toast.error(`Error: ${error.message || `No se pudo ${activate ? 'activar' : 'desactivar'} el período mensual`}`);
    } finally {
      setProcessingPeriodId(null);
    }
  };

  const handleReopenYearClick = (year: LocalFiscalYear) => {
    if (year.id) {
      setSelectedYearId(year.id);
      setReopenReason('');
      setShowReopenModal(true);
    }
  };
  
  const handleReopenYear = async () => {
    if (!user?.id || !selectedYearForReopen || !selectedYearForReopen.id || !reopenReason.trim()) {
      toast.error('Debes iniciar sesión y proporcionar un motivo para reabrir el año fiscal');
      return;
    }
    
    try {
      setProcessingYearId(selectedYearForReopen.id);
      
      // Reabrir año fiscal
      const { success, error } = await reopenFiscalYear(selectedYearForReopen.id, user.id, reopenReason);
      
      if (!success) {
        throw new Error(error || 'Error al reabrir el año fiscal');
      }
      
      toast.success('Año fiscal reabierto correctamente junto con sus períodos mensuales');
      
      // Cerrar modal y refrescar datos
      setShowReopenModal(false);
      setSelectedYearForReopen(null);
      fetchData();
      
    } catch (error: any) {
      console.error('Error al reabrir año fiscal:', error);
      toast.error(`Error: ${error.message || 'No se pudo reabrir el año fiscal'}`);
    } finally {
      setProcessingYearId(null);
    }
  };

  const handleCreateFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
  };

  const handleSubmitCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?.id) {
      toast.error('Debes iniciar sesión para crear un año fiscal');
      return;
    }
    
    try {
      setLoading(true);
      
      // Validar fechas
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);
      
      if (endDate < startDate) {
        toast.error('La fecha de fin debe ser posterior a la fecha de inicio');
        return;
      }
      
      // Crear año fiscal
      const { data, error } = await createFiscalYear(formData, user.id);
      
      if (error) {
        throw new Error(error);
      }
      
      if (!data) {
        throw new Error('No se pudo crear el año fiscal');
      }
      
      toast.success(`Año fiscal ${formData.name} creado correctamente con sus períodos mensuales`);
      
      // Cerrar modal y refrescar datos
      setShowCreateModal(false);
      setFormData({
        name: '',
        start_date: '',
        end_date: '',
        notes: '',
        fiscal_year_type: 'calendar'
      });
      fetchData();
      
    } catch (error: any) {
      console.error('Error al crear año fiscal:', error);
      toast.error(`Error: ${error.message || 'No se pudo crear el año fiscal'}`);
    } finally {
      setLoading(false);
    }
  };

  // Renderizar períodos mensuales para un año fiscal
  const renderMonthlyPeriods = (fiscalYearId: string) => {
    const fiscalYear = fiscalYears.find(year => year.id === fiscalYearId);
    const periods = allMonthlyPeriods.filter(p => p.fiscal_year_id === fiscalYearId);
    
    if (periods.length === 0) {
      return (
        <div className="text-center py-4">
          <p className="text-gray-500">No hay períodos mensuales para este año fiscal.</p>
        </div>
      );
    }
    
    return (
      <div className="grid gap-2">
        {periods.map(period => (
          <div 
            key={period.id}
            className={`p-3 rounded-lg border ${
              period.is_active 
                ? 'border-green-500 bg-green-50' 
                : 'border-gray-300'
            } ${
              period.is_closed 
                ? 'opacity-70 bg-gray-100' 
                : ''
            }`}
          >
            <div className="flex justify-between items-center">
              <div>
                <h4 className="font-medium">{period.name}</h4>
                <p className="text-sm text-gray-500">
                  {new Date(period.start_date).toLocaleDateString()} - {new Date(period.end_date).toLocaleDateString()}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {period.id && periodStats[period.id] 
                    ? `${periodStats[period.id].count} asientos contables` 
                    : '0 asientos contables'}
                </p>
              </div>
              <div className="flex flex-col space-y-2">
                <div className="flex space-x-2">
                  {period.is_closed ? (
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded-full">
                      Cerrado
                    </span>
                  ) : (
                    <span className={`px-2 py-1 ${period.is_active ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-700'} text-xs rounded-full`}>
                      {period.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  )}
                </div>
                
                {/* Mostrar botones solo cuando el período no está cerrado */}
                {!period.is_closed && (
                  <div className="flex space-x-2">
                    {!fiscalYear?.is_active ? (
                      <span className="text-xs text-gray-500 italic">El año fiscal está inactivo</span>
                    ) : (
                      <>
                        {period.is_active ? (
                          <button
                            onClick={() => handleTogglePeriodActive(period, false)}
                            disabled={processingPeriodId === period.id}
                            className="text-xs text-yellow-600 hover:text-yellow-800"
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            onClick={() => handleTogglePeriodActive(period, true)}
                            disabled={processingPeriodId === period.id}
                            className="text-xs text-green-600 hover:text-green-800"
                          >
                            Activar
                          </button>
                        )}
                        <button
                          onClick={() => handleClosePeriod(period)}
                          disabled={processingPeriodId === period.id}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Cerrar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading && fiscalYears.length === 0) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-gray-200 rounded max-w-md mb-6"></div>
        <div className="h-40 bg-gray-200 rounded mb-4"></div>
        <div className="h-40 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Gestión de Años Fiscales y Períodos</h2>
        <div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus className="mr-1 h-4 w-4" />
            Nuevo Año Fiscal
          </button>
        </div>
      </div>

      {/* Vista por años fiscales */}
      {fiscalYears.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center">
            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No hay años fiscales configurados</h3>
            <p className="text-gray-500 mb-4">
              Crea un nuevo año fiscal para comenzar a gestionar tus períodos contables.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Crear Año Fiscal
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {fiscalYears.map(year => (
            <div key={year.id} className="bg-white shadow rounded-lg overflow-hidden">
              <div 
                className={`px-4 py-3 flex justify-between items-center cursor-pointer ${
                  year.is_closed 
                    ? 'bg-gray-100' 
                    : year.is_active 
                      ? 'bg-green-50 border-l-4 border-green-500' 
                      : 'bg-gray-50'
                }`}
                onClick={() => toggleYearExpansion(year.id)}
              >
                <div className="flex items-center space-x-2">
                  <Calendar className="h-5 w-5 text-gray-500" />
                  <div>
                    <h3 className="font-medium">{year.name}</h3>
                    <p className="text-sm text-gray-500">
                      {new Date(year.start_date).toLocaleDateString()} - {new Date(year.end_date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {year.is_closed ? (
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded-full">
                      Cerrado
                    </span>
                  ) : (
                    <span className={`px-2 py-1 ${year.is_active ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-700'} text-xs rounded-full`}>
                      {year.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  )}
                  
                  {expandedYears.includes(year.id) ? (
                    <ChevronUp className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  )}
                </div>
              </div>
              
              {expandedYears.includes(year.id) && (
                <div className="p-4 shadow rounded-lg bg-white border border-gray-200">
                  <div className="mb-4">
                    <div className="flex flex-wrap gap-2 mb-4">
                      {!year.is_closed && (
                        <button
                          onClick={() => {
                            if (window.confirm(`¿Estás seguro de ${year.is_active ? 'desactivar' : 'activar'} el año fiscal ${year.name}?`)) {
                              handleToggleYearActive(year, !year.is_active);
                            }
                          }}
                          disabled={processingYearId === year.id}
                          className={`px-4 py-2 text-sm font-medium rounded-md text-white ${
                            year.is_active 
                              ? 'bg-yellow-500 hover:bg-yellow-700' 
                              : 'bg-green-500 hover:bg-green-700'
                          } disabled:opacity-50`}
                        >
                          {year.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      
                      {!year.is_closed && (
                        <button
                          onClick={() => {
                            if (window.confirm(`¿Estás seguro de cerrar el año fiscal ${year.name}? Esta acción cerrará todos los períodos mensuales asociados y no podrás registrar nuevos asientos.`)) {
                              handleCloseYear(year);
                            }
                          }}
                          disabled={processingYearId === year.id}
                          className="px-4 py-2 text-sm font-medium rounded-md text-white bg-red-500 hover:bg-red-700 disabled:opacity-50"
                        >
                          Cerrar Año Fiscal
                        </button>
                      )}
                      
                      {year.is_closed && (
                        <button
                          onClick={() => {
                            setSelectedYearForReopen(year);
                            setReopenReason('');
                            setShowReopenModal(true);
                          }}
                          disabled={processingYearId === year.id}
                          className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-700 disabled:opacity-50"
                        >
                          Reabrir Año Fiscal
                        </button>
                      )}
                    </div>
                    
                    {!year.has_monthly_periods && !loading ? (
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleInitializeMonthlyPeriods(year.id)}
                          disabled={processingYearId === year.id}
                          className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-700 disabled:opacity-50"
                        >
                          Inicializar Períodos Mensuales
                        </button>
                      </div>
                    ) : (
                      renderMonthlyPeriods(year.id)
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal para crear año fiscal */}
      <Modal
        title="Crear Nuevo Año Fiscal"
        onClose={() => setShowCreateModal(false)}
        isOpen={showCreateModal}
      >
        <form onSubmit={handleSubmitCreateForm} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Nombre del Año Fiscal
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleCreateFormChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="ej. Año Fiscal 2023"
            />
          </div>
          
          <div>
            <label htmlFor="fiscal_year_type" className="block text-sm font-medium text-gray-700">
              Tipo de Año Fiscal
            </label>
            <select
              id="fiscal_year_type"
              name="fiscal_year_type"
              required
              value={formData.fiscal_year_type}
              onChange={handleCreateFormChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            >
              <option value="calendar">Año Calendario (Ene-Dic)</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">
                Fecha de Inicio
              </label>
              <input
                type="date"
                id="start_date"
                name="start_date"
                required
                value={formData.start_date}
                onChange={handleCreateFormChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            
            <div>
              <label htmlFor="end_date" className="block text-sm font-medium text-gray-700">
                Fecha de Fin
              </label>
              <input
                type="date"
                id="end_date"
                name="end_date"
                required
                value={formData.end_date}
                onChange={handleCreateFormChange}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
          </div>
          
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notas (opcional)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              value={formData.notes}
              onChange={handleCreateFormChange}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Notas adicionales sobre este período mensual"
            />
          </div>
          
          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 mr-2 text-sm font-medium rounded-md text-gray-800 bg-gray-300 hover:bg-gray-400 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!formData.name || !formData.start_date || !formData.end_date || loading}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-700 disabled:opacity-50"
            >
              Crear Año Fiscal
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal para reabrir año fiscal */}
      <Modal
        title="Reabrir Año Fiscal"
        onClose={() => setShowReopenModal(false)}
        isOpen={showReopenModal}
      >
        <div className="space-y-4">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md">
            <div className="flex">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  Reabrir un año fiscal cerrado es una acción excepcional que debe usarse solo cuando sea absolutamente necesario.
                  Esta acción quedará registrada en el sistema.
                </p>
              </div>
            </div>
          </div>
          
          <div>
            <label htmlFor="reopen_reason" className="block text-sm font-medium text-gray-700">
              Motivo de Reapertura (requerido)
            </label>
            <textarea
              id="reopen_reason"
              rows={4}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Explique el motivo por el que necesita reabrir este año fiscal"
              required
            />
          </div>
          
          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={() => {
                setShowReopenModal(false);
                setSelectedYearForReopen(null);
              }}
              className="px-4 py-2 mr-2 text-sm font-medium rounded-md text-gray-800 bg-gray-300 hover:bg-gray-400 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (selectedYearForReopen && selectedYearForReopen.id) {
                  handleReopenYear();
                }
              }}
              disabled={!reopenReason.trim() || processingYearId !== null}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-500 hover:bg-blue-700 disabled:opacity-50"
            >
              Confirmar Reapertura
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
} 