/**
 * Role-Based Access Control (RBAC) System
 * 
 * Implements CATC governance tiers with role-based authorization.
 * Provides middleware for route protection and PHI field filtering.
 * 
 * Usage:
 *   const rbac = require('./security/rbac');
 *   
 *   // Protect route with role requirement
 *   app.get('/api/patients/:id', rbac.requireRole('physician', 'nurse_practitioner'), handler);
 *   
 *   // Check permissions
 *   app.post('/api/prescriptions', 
 *     rbac.requireRole('physician', 'nurse_practitioner'),
 *     rbac.requirePermission('sign', 'prescriptions'),
 *     handler
 *   );
 *   
 *   // Filter response data based on role
 *   const filteredData = rbac.filterPHI(userRole, patientData);
 */

// ==========================================
// ROLE DEFINITIONS & PERMISSIONS
// ==========================================

/**
 * Role-Permission Matrix
 * Defines what each role can access, modify, and sign
 */
const ROLES = {
  physician: {
    label: 'Physician',
    tier: 3,
    canAccess: {
      patients: true,
      encounters: true,
      problems: true,
      medications: true,
      allergies: true,
      labs: true,
      vitals: true,
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: true,
      audit_logs: false,  // Physicians can't access audit logs
      agent_results: true,
      agent_governance: true,
    },
    canWrite: {
      patients: true,
      encounters: true,
      problems: true,
      medications: false,  // Can't directly write meds (must go through prescriptions)
      allergies: true,
      labs: false,  // Labs created by orders, not directly
      vitals: false,  // Typically entered by MA
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: false,  // Billing is read-only for physicians
      audit_logs: false,
      agent_results: false,  // Results created by agents, physician reviews
      agent_governance: true,
    },
    canSign: {
      prescriptions: true,
      notes: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
    },
    canOverride: [
      'scribe', 'cds', 'orders', 'coding', 'quality',           // Encounter agents
      'phone_triage', 'front_desk', 'ma', 'physician',           // Pre-visit agents
      'agent_order_review', 'agent_medication_safety',            // Action categories
      'agent_drug_interaction', 'agent_documentation'
    ],
    phiScope: ['all'],  // Full access to all PHI
    description: 'Full clinical access, can sign orders and notes, approve agents',
  },

  nurse_practitioner: {
    label: 'Nurse Practitioner',
    tier: 3,  // Same approval tier as physician
    canAccess: {
      patients: true,
      encounters: true,
      problems: true,
      medications: true,
      allergies: true,
      labs: true,
      vitals: true,
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: true,
      audit_logs: false,
      agent_results: true,
      agent_governance: true,
    },
    canWrite: {
      patients: true,
      encounters: true,
      problems: true,
      medications: false,
      allergies: true,
      labs: false,
      vitals: false,
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: false,
      audit_logs: false,
      agent_results: false,
      agent_governance: true,
    },
    canSign: {
      prescriptions: true,
      notes: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
    },
    canOverride: [
      'scribe', 'cds', 'orders', 'coding', 'quality',
      'phone_triage', 'front_desk', 'ma', 'physician',
      'agent_order_review', 'agent_medication_safety',
      'agent_drug_interaction', 'agent_documentation'
    ],
    phiScope: ['all'],
    description: 'NP-led encounter authority, can sign orders and notes',
  },

  ma: {
    label: 'Medical Assistant',
    tier: 1,
    canAccess: {
      patients: true,
      encounters: true,
      problems: true,
      medications: true,
      allergies: true,
      labs: true,
      vitals: true,
      prescriptions: false,  // Can view to route refills
      lab_orders: true,  // View only
      imaging_orders: true,  // View only
      referrals: true,  // View only
      notes: false,  // Cannot access clinical notes
      billing: false,
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canWrite: {
      patients: false,  // Can't modify patient demo
      encounters: false,
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: true,  // Can record vitals
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: false,
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canSign: {},
    canOverride: [],
    phiScope: ['demographics', 'vitals', 'allergies', 'medications', 'problems'],
    description: 'Records vitals, routes refills, views clinical data (not notes)',
  },

  front_desk: {
    label: 'Front Desk',
    tier: 0,
    canAccess: {
      patients: true,  // Demographics only
      encounters: true,  // Scheduling only
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: false,
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canWrite: {
      patients: false,  // Can't write patient data
      encounters: true,  // Can schedule encounters
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: false,
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canSign: {},
    canOverride: [],
    phiScope: ['demographics'],  // Demographics only (name, DOB, phone, email, MRN)
    description: 'Scheduling, demographics access only',
  },

  billing: {
    label: 'Billing',
    tier: 1,
    canAccess: {
      patients: true,  // Demographics for billing
      encounters: true,  // Encounter data for coding
      problems: true,  // Diagnosis for coding
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,  // Cannot see clinical notes
      billing: true,  // Full billing access
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canWrite: {
      patients: false,
      encounters: false,
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: true,  // Can modify billing records
      audit_logs: false,
      agent_results: false,
      agent_governance: false,
    },
    canSign: {},
    canOverride: [],
    phiScope: ['demographics', 'diagnosis', 'icd10_code', 'cpt_code'],
    description: 'Coding, CPT/ICD-10, billing records only',
  },

  admin: {
    label: 'Administrator',
    tier: 3,
    canAccess: {
      patients: false,  // Admin can't directly view patient data
      encounters: false,
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: false,
      audit_logs: true,  // Full audit log access
      agent_results: false,
      agent_governance: false,
    },
    canWrite: {
      patients: false,
      encounters: false,
      problems: false,
      medications: false,
      allergies: false,
      labs: false,
      vitals: false,
      prescriptions: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
      notes: false,
      billing: false,
      audit_logs: false,  // Audit logs are immutable
      agent_results: false,
      agent_governance: false,
    },
    canSign: {},
    canOverride: [],
    phiScope: [],  // No direct PHI access
    description: 'System management, audit logs, user administration',
  },

  system: {
    label: 'System Agent',
    tier: 3,
    canAccess: {
      patients: true,
      encounters: true,
      problems: true,
      medications: true,
      allergies: true,
      labs: true,
      vitals: true,
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: true,
      audit_logs: true,  // System agents can read audit logs
      agent_results: true,
      agent_governance: true,
    },
    canWrite: {
      patients: true,
      encounters: true,
      problems: true,
      medications: true,
      allergies: true,
      labs: true,
      vitals: true,
      prescriptions: true,
      lab_orders: true,
      imaging_orders: true,
      referrals: true,
      notes: true,
      billing: true,
      audit_logs: true,  // Can log
      agent_results: true,
      agent_governance: true,
    },
    canSign: {
      prescriptions: false,  // System can't sign - only suggest
      notes: false,
      lab_orders: false,
      imaging_orders: false,
      referrals: false,
    },
    canOverride: [],  // Agents don't override others
    phiScope: ['all'],
    description: 'AI agent with full data access (all actions logged)',
  },
};

/**
 * PHI field definitions mapped to scope
 */
const PHI_FIELDS_BY_SCOPE = {
  demographics: [
    'id', 'mrn', 'first_name', 'middle_name', 'last_name', 'name',
    'dob', 'date_of_birth', 'sex', 'phone', 'email',
    'address_line1', 'address_line2', 'city', 'state', 'zip',
  ],
  insurance: [
    'insurance_carrier', 'insurance_id', 'insurance_group',
  ],
  vitals: [
    'vital_signs', 'temperature', 'pulse', 'respiratory_rate',
    'blood_pressure', 'oxygen_saturation', 'height', 'weight', 'bmi',
  ],
  clinical: [
    'diagnosis', 'assessment', 'plan', 'notes', 'encounter_notes',
    'physical_exam', 'review_of_systems', 'history_of_present_illness',
  ],
  medications: [
    'medications', 'prescription', 'medication_name', 'dosage',
    'frequency', 'indication', 'start_date', 'end_date',
  ],
  allergies: [
    'allergies', 'allergy_name', 'reaction', 'severity',
  ],
  diagnosis: [
    'icd10_code', 'diagnosis_code', 'cpt_code', 'snomed_code',
    'problem_description',
  ],
};

// ==========================================
// AUTHORIZATION CHECKS
// ==========================================

/**
 * Get role configuration
 */
function getRole(roleName) {
  return ROLES[roleName] || null;
}

/**
 * Check if role can access resource type
 */
function canAccess(roleName, resourceType) {
  const role = ROLES[roleName];
  if (!role) return false;
  return role.canAccess[resourceType] === true;
}

/**
 * Check if role can write to resource type
 */
function canWrite(roleName, resourceType) {
  const role = ROLES[roleName];
  if (!role) return false;
  return role.canWrite[resourceType] === true;
}

/**
 * Check if role can sign/finalize resource
 */
function canSign(roleName, resourceType) {
  const role = ROLES[roleName];
  if (!role) return false;
  return role.canSign[resourceType] === true;
}

/**
 * Check if role can override a specific agent
 */
function canOverride(roleName, agentName) {
  const role = ROLES[roleName];
  if (!role) return false;
  return role.canOverride.includes(agentName);
}

/**
 * Check authorization for specific action
 */
function authorize(roleName, resourceType, action) {
  if (!ROLES[roleName]) return false;
  
  switch (action.toLowerCase()) {
    case 'read':
    case 'access':
      return canAccess(roleName, resourceType);
    case 'write':
    case 'create':
    case 'update':
      return canWrite(roleName, resourceType);
    case 'delete':
      // Only physicians and admins can delete
      return ['physician', 'nurse_practitioner', 'admin'].includes(roleName) &&
             canWrite(roleName, resourceType);
    case 'sign':
      return canSign(roleName, resourceType);
    default:
      return false;
  }
}

// ==========================================
// PHI FILTERING
// ==========================================

/**
 * Filter PHI from data based on role scope
 * Removes fields the role is not authorized to see
 */
function filterPHI(roleName, data) {
  const role = ROLES[roleName];
  if (!role) return null;
  
  // System role sees everything
  if (role.phiScope.includes('all')) {
    return data;
  }
  
  // Build allowed fields from role's PHI scope
  const allowedFields = new Set();
  role.phiScope.forEach(scope => {
    if (PHI_FIELDS_BY_SCOPE[scope]) {
      PHI_FIELDS_BY_SCOPE[scope].forEach(field => {
        allowedFields.add(field);
      });
    }
  });
  
  // Always allow structural fields
  allowedFields.add('id');
  allowedFields.add('timestamp');
  allowedFields.add('created_at');
  allowedFields.add('updated_at');
  
  return filterObject(data, allowedFields);
}

/**
 * Recursively filter object to only include allowed fields
 */
function filterObject(obj, allowedFields) {
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => filterObject(item, allowedFields));
  }
  
  if (typeof obj === 'object') {
    const filtered = {};
    for (const [key, value] of Object.entries(obj)) {
      if (allowedFields.has(key)) {
        if (typeof value === 'object' && value !== null) {
          filtered[key] = filterObject(value, allowedFields);
        } else {
          filtered[key] = value;
        }
      }
    }
    return filtered;
  }
  
  return obj;
}

/**
 * Get PHI scope as array of field names for a role
 */
function getPhiScopeFields(roleName) {
  const role = ROLES[roleName];
  if (!role) return [];
  
  if (role.phiScope.includes('all')) {
    return Object.values(PHI_FIELDS_BY_SCOPE).flat();
  }
  
  const fields = new Set();
  role.phiScope.forEach(scope => {
    if (PHI_FIELDS_BY_SCOPE[scope]) {
      PHI_FIELDS_BY_SCOPE[scope].forEach(field => fields.add(field));
    }
  });
  
  return Array.from(fields);
}

// ==========================================
// EXPRESS MIDDLEWARE
// ==========================================

/**
 * Middleware: require one or more roles
 * Usage: app.get('/api/patients', rbac.requireRole('physician', 'nurse_practitioner'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // In development mode, default to physician role for testing
    // In production, this MUST come from authenticated session/JWT
    const isDev = process.env.NODE_ENV !== 'production';
    const defaultRole = isDev ? 'physician' : 'guest';

    const userRole = req.session?.userRole || req.headers['x-user-role'] || defaultRole;
    const userId = req.session?.userId || req.headers['x-user-id'] || 'anonymous';

    // Attach role to request for downstream middleware
    req.userRole = userRole;
    req.userId = userId;

    if (!allowedRoles.includes(userRole)) {
      console.warn(`[RBAC] Access denied: user ${userId} (role: ${userRole}) attempted unauthorized access to ${req.path}`);
      return res.status(403).json({
        error: 'Insufficient permissions',
        requiredRoles: allowedRoles,
        userRole,
      });
    }

    next();
  };
}

/**
 * Middleware: require specific permission
 * Usage: app.post('/api/prescriptions', rbac.requirePermission('sign', 'prescriptions'), handler)
 */
function requirePermission(action, resourceType) {
  return (req, res, next) => {
    const userRole = req.session?.userRole || req.headers['x-user-role'] || 'guest';
    const userId = req.session?.userId || req.headers['x-user-id'] || 'anonymous';
    
    if (!authorize(userRole, resourceType, action)) {
      console.warn(
        `[RBAC] Permission denied: user ${userId} (role: ${userRole}) ` +
        `attempted ${action} on ${resourceType}`
      );
      return res.status(403).json({
        error: `Permission denied: cannot ${action} ${resourceType}`,
        userRole,
        requiredAction: action,
        requiredResource: resourceType,
      });
    }
    
    next();
  };
}

/**
 * Middleware: automatically filter response data based on role
 * Strips PHI that the user's role cannot access
 * Usage: app.get('/api/patients/:id', rbac.filterResponse, handler)
 */
function filterResponse(req, res, next) {
  const userRole = req.session?.userRole || req.headers['x-user-role'] || 'guest';
  
  // Wrap res.json to filter response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const filtered = filterPHI(userRole, data);
    return originalJson(filtered);
  };
  
  next();
}

/**
 * Middleware: require resource access
 * Combines role check with resource-specific authorization
 * Usage: app.get('/api/patients/:id', rbac.requireResourceAccess('patients'), handler)
 */
function requireResourceAccess(resourceType) {
  return (req, res, next) => {
    const userRole = req.session?.userRole || req.headers['x-user-role'] || 'guest';
    const userId = req.session?.userId || req.headers['x-user-id'] || 'anonymous';
    
    // Determine action from HTTP method
    const action = {
      'GET': 'access',
      'POST': 'create',
      'PUT': 'update',
      'PATCH': 'update',
      'DELETE': 'delete',
    }[req.method] || 'access';
    
    if (!authorize(userRole, resourceType, action)) {
      console.warn(
        `[RBAC] Resource access denied: user ${userId} (role: ${userRole}) ` +
        `attempted ${action} on ${resourceType}`
      );
      return res.status(403).json({
        error: `Cannot ${action} ${resourceType}`,
        userRole,
      });
    }
    
    next();
  };
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get all roles (for admin UI, etc)
 */
function getAllRoles() {
  return Object.entries(ROLES).map(([name, config]) => ({
    name,
    ...config,
  }));
}

/**
 * Get role hierarchy - roles that are "higher" than the given role
 */
function getSuperiorRoles(roleName) {
  const role = ROLES[roleName];
  if (!role) return [];
  
  return Object.entries(ROLES)
    .filter(([_, r]) => r.tier > role.tier)
    .map(([name, _]) => name);
}

/**
 * Check if role1 has authority over role2
 */
function hasAuthority(role1, role2) {
  const r1 = ROLES[role1];
  const r2 = ROLES[role2];
  if (!r1 || !r2) return false;
  return r1.tier >= r2.tier;
}

/**
 * Validate that a user's permissions are consistent with their role
 */
function validateUserPermissions(userRole, grantedPermissions) {
  const role = ROLES[userRole];
  if (!role) return false;
  
  // All granted permissions should be allowed by the role
  return grantedPermissions.every(perm => {
    const [action, resource] = perm.split(':');
    return authorize(userRole, resource, action);
  });
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
  // Constants
  ROLES,
  PHI_FIELDS_BY_SCOPE,
  
  // Authorization checks
  getRole,
  canAccess,
  canWrite,
  canSign,
  canOverride,
  authorize,
  
  // PHI filtering
  filterPHI,
  filterObject,
  getPhiScopeFields,
  
  // Middleware
  requireRole,
  requirePermission,
  filterResponse,
  requireResourceAccess,
  
  // Utilities
  getAllRoles,
  getSuperiorRoles,
  hasAuthority,
  validateUserPermissions,
};
